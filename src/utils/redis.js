const Redis = require('ioredis')
const { logger } = require('./logger')

let config; // 将在 initialize 中异步加载

/**
 * Redis 连接管理器
 * 实现按需连接机制，仅在读写操作时建立连接
 */

// 连接配置
const REDIS_CONFIG = {
  maxRetries: 3,
  connectTimeout: 10000,
  commandTimeout: 5000,
  retryDelayOnFailover: 200,
  maxRetriesPerRequest: 3,
  enableOfflineQueue: false,
  lazyConnect: true,
  keepAlive: 30000,
  connectionName: 'qwen2api_on_demand'
}

// 连接状态
let redis = null
let isConnecting = false
let connectionPromise = null
let lastActivity = 0
let idleTimer = null

// 空闲超时时间 (5分钟)
const IDLE_TIMEOUT = 5 * 60 * 1000

/**
 * 判断是否需要TLS
 */
const isTLS = () => config && config.redisURL && (config.redisURL.startsWith('rediss://') || config.redisURL.includes('--tls'))

/**
 * 创建Redis连接配置
 */
const createRedisConfig = () => ({
  ...REDIS_CONFIG,
  // TLS配置
  ...(isTLS() ? {
    tls: {
      rejectUnauthorized: true
    }
  } : {}),

  // 重试策略
  retryStrategy(times) {
    if (times > REDIS_CONFIG.maxRetries) {
      logger.error(`Redis连接重试次数超限: ${times}`, 'REDIS')
      return null
    }

    const delay = Math.min(100 * Math.pow(2, times), 3000)
    logger.info(`Redis重试连接: ${times}, 延迟: ${delay}ms`, 'REDIS', '🔄')
    return delay
  },

  // 错误重连策略
  reconnectOnError(err) {
    const targetErrors = ['READONLY', 'ETIMEDOUT', 'ECONNRESET', 'EPIPE']
    return targetErrors.some(e => err.message.includes(e))
  }
})

/**
 * 更新活动时间并重置空闲定时器
 */
const updateActivity = () => {
  lastActivity = Date.now()

  // 清除现有定时器
  if (idleTimer) {
    clearTimeout(idleTimer)
  }

  // 设置新的空闲定时器
  idleTimer = setTimeout(() => {
    if (redis && Date.now() - lastActivity > IDLE_TIMEOUT) {
      logger.info('Redis连接空闲超时，断开连接', 'REDIS', '🔌')
      disconnectRedis()
    }
  }, IDLE_TIMEOUT)
}

/**
 * 建立Redis连接
 */
const connectRedis = async () => {
  if (redis && redis.status === 'ready') {
    updateActivity()
    return redis
  }

  if (isConnecting && connectionPromise) {
    return connectionPromise
  }

  isConnecting = true
  connectionPromise = new Promise(async (resolve, reject) => {
    try {
      logger.info('建立Redis连接...', 'REDIS', '🔌')

      const newRedis = new Redis(config.redisURL, createRedisConfig())

      // 设置事件监听器
      newRedis.on('connect', () => {
        logger.success('Redis连接建立', 'REDIS')
      })

      newRedis.on('ready', () => {
        logger.success('Redis准备就绪', 'REDIS')
        redis = newRedis
        isConnecting = false
        updateActivity()
        resolve(redis)
      })

      newRedis.on('error', (err) => {
        logger.error('Redis连接错误', 'REDIS', '', err)
        if (isConnecting) {
          isConnecting = false
          reject(err)
        }
      })

      newRedis.on('close', () => {
        logger.info('Redis连接关闭', 'REDIS', '🔌')
        redis = null
      })

      newRedis.on('reconnecting', (delay) => {
        logger.info(`Redis重新连接中...延迟: ${delay}ms`, 'REDIS', '🔄')
      })

      // 等待连接就绪
      await newRedis.connect()

    } catch (error) {
      isConnecting = false
      logger.error('Redis连接失败', 'REDIS', '', error)
      reject(error)
    }
  })

  return connectionPromise
}

/**
 * 断开Redis连接
 */
const disconnectRedis = async () => {
  if (idleTimer) {
    clearTimeout(idleTimer)
    idleTimer = null
  }

  if (redis) {
    try {
      await redis.disconnect()
      logger.info('Redis连接已断开', 'REDIS', '🔌')
    } catch (error) {
      logger.error('断开Redis连接时出错', 'REDIS', '', error)
    } finally {
      redis = null
      isConnecting = false
      connectionPromise = null
    }
  }
}

/**
 * 确保Redis连接可用
 */
const ensureConnection = async () => {
  if (!config) {
    // 如果配置尚未加载，则无法继续
    throw new Error('Redis模块尚未初始化，无法建立连接');
  }
  if (config.dataSaveMode !== 'redis') {
    // logger.error('当前数据保存模式不是Redis', 'REDIS')
    throw new Error('当前数据保存模式不是Redis')
  }

  if (!redis || redis.status !== 'ready') {
    return await connectRedis()
  }

  updateActivity()
  return redis
}

/**
 * 获取所有账户
 * @returns {Promise<Array>} 所有账户信息数组
 */
const getAllAccounts = async () => {
  try {
    const client = await ensureConnection()

    // 使用SCAN命令替代KEYS命令，避免阻塞Redis服务器
    const keys = []
    let cursor = '0'

    do {
      const result = await client.scan(cursor, 'MATCH', 'user:*', 'COUNT', 100)
      cursor = result
      keys.push(...result)
    } while (cursor !== '0')

    if (!keys.length) {
      logger.info('没有找到任何账户', 'REDIS', '✅')
      return []
    }

    // 使用pipeline一次性获取所有账户数据
    const pipeline = client.pipeline()
    keys.forEach(key => {
      pipeline.hgetall(key)
    })

    const results = await pipeline.exec()
    if (!results) {
      logger.error('获取账户数据失败', 'REDIS')
      return []
    }

    const accounts = results.map((result, index) => {
      // result格式为[err, value]
      const [err, accountData] = result
      if (err) {
        logger.error(`获取账户 ${keys[index]} 数据失败`, 'REDIS', '', err)
        return null
      }
      if (!accountData || Object.keys(accountData).length === 0) {
        logger.error(`账户 ${keys[index]} 数据为空`, 'REDIS')
        return null
      }
      return {
        email: keys[index].replace('user:', ''),
        password: accountData.password || '',
        token: accountData.token || '',
        expires: accountData.expires || ''
      }
    }).filter(Boolean) // 过滤掉null值

    logger.success(`获取所有账户成功，共 ${accounts.length} 个账户`, 'REDIS')
    return accounts
  } catch (err) {
    logger.error('获取账户时出错', 'REDIS', '', err)
    return []
  }
}

/**
 * 设置账户
 * @param {string} key - 键名（邮箱）
 * @param {Object} value - 账户信息
 * @returns {Promise<boolean>} 设置是否成功
 */
const setAccount = async (key, value) => {
  try {
    const client = await ensureConnection()

    const { password, token, expires } = value
    await client.hset(`user:${key}`, {
      password: password || '',
      token: token || '',
      expires: expires || ''
    })

    logger.success(`账户 ${key} 设置成功`, 'REDIS')
    return true
  } catch (err) {
    logger.error(`设置账户 ${key} 失败`, 'REDIS', '', err)
    return false
  }
}

/**
 * 删除账户
 * @param {string} key - 键名（邮箱）
 * @returns {Promise<boolean>} 删除是否成功
 */
const deleteAccount = async (key) => {
  try {
    const client = await ensureConnection()

    const result = await client.del(`user:${key}`)
    if (result > 0) {
      logger.success(`账户 ${key} 删除成功`, 'REDIS')
      return true
    } else {
      logger.warn(`账户 ${key} 不存在`, 'REDIS')
      return false
    }
  } catch (err) {
    logger.error(`删除账户 ${key} 失败`, 'REDIS', '', err)
    return false
  }
}

/**
 * 检查键是否存在
 * @param {string} key - 键名
 * @returns {Promise<boolean>} 键是否存在
 */
const checkKeyExists = async (key = 'headers') => {
  try {
    const client = await ensureConnection()

    const exists = await client.exists(key)
    const result = exists === 1

    logger.info(`键 "${key}" ${result ? '存在' : '不存在'}`, 'REDIS', result ? '✅' : '❌')
    return result
  } catch (err) {
    logger.error(`检查键 "${key}" 时出错`, 'REDIS', '', err)
    return false
  }
}

/**
 * 获取连接状态
 * @returns {Object} 连接状态信息
 */
const getConnectionStatus = () => {
  return {
    connected: redis && redis.status === 'ready',
    status: redis ? redis.status : 'disconnected',
    lastActivity: lastActivity,
    idleTimeout: IDLE_TIMEOUT,
    config: REDIS_CONFIG
  }
}

/**
 * 手动断开连接（用于应用关闭时清理）
 */
const cleanup = async () => {
  logger.info('清理Redis连接...', 'REDIS', '🧹')
  await disconnectRedis()
}

// 创建兼容的Redis客户端对象
const redisClient = {
  getAllAccounts,
  setAccount,
  deleteAccount,
  checkKeyExists,
  getConnectionStatus,
  cleanup,
  // 为 Redis 模式实现的代理绑定管理方法
  // 使用 Redis 的 hash 存储 'proxy_bindings' -> { email: proxy_url }
  async getAllProxyBindings() {
    if (!config || config.dataSaveMode !== 'redis') {
      // logger.error('getAllProxyBindings called but dataSaveMode is not redis', 'REDIS');
      return {};
    }
    try {
      const client = await ensureConnection();
      const bindingsHashKey = 'proxy_bindings';
      const bindingsMap = await client.hgetall(bindingsHashKey);
      logger.info(`从 Redis 加载了 ${Object.keys(bindingsMap).length} 个代理绑定`, 'REDIS');
      return bindingsMap; // 返回一个普通对象
    } catch (err) {
      logger.error('从 Redis 获取代理绑定失败', 'REDIS', '', err);
      return {}; // 失败时返回空对象
    }
  },

  async setProxyBinding(email, proxyUrl) {
    if (!config || config.dataSaveMode !== 'redis') {
      // logger.error('setProxyBinding called but dataSaveMode is not redis', 'REDIS');
      return false;
    }
    try {
      const client = await ensureConnection();
      const bindingsHashKey = 'proxy_bindings';
      await client.hset(bindingsHashKey, email, proxyUrl);
      logger.success(`代理绑定 ${email} -> ${proxyUrl} 已保存到 Redis`, 'REDIS');
      return true;
    } catch (err) {
      logger.error(`将代理绑定 ${email} -> ${proxyUrl} 保存到 Redis 失败`, 'REDIS', '', err);
      return false;
    }
  },

  // 直接Redis命令的代理方法（按需连接）
  async hset(key, ...args) {
    const client = await ensureConnection()
    return client.hset(key, ...args)
  },

  async hget(key, field) {
    const client = await ensureConnection()
    return client.hget(key, field)
  },

  async hgetall(key) {
    const client = await ensureConnection()
    return client.hgetall(key)
  },

  async exists(key) {
    const client = await ensureConnection()
    return client.exists(key)
  },

  async keys(pattern) {
    const client = await ensureConnection()
    // 使用SCAN命令替代KEYS命令，避免阻塞Redis服务器
    const keys = []
    let cursor = '0'

    do {
      const result = await client.scan(cursor, 'MATCH', pattern, 'COUNT', 100)
      cursor = result
      keys.push(...result)
    } while (cursor !== '0')

    return keys
  },

  async del(key) {
    const client = await ensureConnection()
    return client.del(key)
  }
}

// 进程退出时清理连接
process.on('exit', cleanup)
process.on('SIGINT', cleanup)
process.on('SIGTERM', cleanup)

// 修改导出逻辑
let initializationPromise = null;

const initialize = async () => {
    // 动态导入以避免循环依赖
    const loadConfig = require('../config/index.js');
    config = await loadConfig();
    if (config.dataSaveMode === 'redis') {
        return redisClient;
    }
    return null;
};

module.exports = () => {
    if (!initializationPromise) {
        initializationPromise = initialize();
    }
    return initializationPromise;
};
