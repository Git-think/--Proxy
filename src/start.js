const { syncProcessSetEnv } = require('./utils/pre-config');
syncProcessSetEnv();

const cluster = require('cluster');
const os = require('os');

// Now that pre-config has run, we can safely load other modules
const fileConfig = require('./utils/file-config');
const { logger } = require('./utils/logger');

// Load .env file which might have been modified by pre-config
require('dotenv').config();

(async () => {

// 获取CPU核心数
const cpuCores = os.cpus().length

// 获取环境变量配置
const PM2_INSTANCES = process.env.PM2_INSTANCES || '1'
const SERVICE_PORT = process.env.SERVICE_PORT || 3000
const NODE_ENV = process.env.NODE_ENV || 'production'

// 解析进程数
let instances
if (PM2_INSTANCES === 'max') {
  instances = cpuCores
} else if (!isNaN(PM2_INSTANCES)) {
  instances = parseInt(PM2_INSTANCES)
} else {
  instances = 1
}

// 限制进程数不能超过CPU核心数
if (instances > cpuCores) {
  logger.warn(`配置的进程数(${instances})超过CPU核心数(${cpuCores})，自动调整为${cpuCores}`, 'AUTO')
  instances = cpuCores
}

logger.info('🚀 Qwen2API 智能启动', 'AUTO')
logger.info(`CPU核心数: ${cpuCores}`, 'AUTO')
logger.info(`配置的进程数: ${PM2_INSTANCES}`, 'AUTO')
logger.info(`实际启动进程数: ${instances}`, 'AUTO')
logger.info(`服务端口: ${SERVICE_PORT}`, 'AUTO')

// 智能判断启动方式
if (instances === 1) {
    logger.info('📦 使用单进程模式启动', 'AUTO');
    await fileConfig.applyFileConfig();
    require('./server.js');
} else {
    // 检查是否通过PM2启动
    if (process.env.PM2_USAGE || process.env.pm_id !== undefined) {
        logger.info(`PM2进程启动 - 进程ID: ${process.pid}, 工作进程ID: ${process.env.pm_id || 'unknown'}`, 'PM2');
        await fileConfig.applyFileConfig();
        require('./server.js');
    } else if (cluster.isMaster) {
        logger.info(`🔥 使用Node.js集群模式启动 (${instances}个进程)`, 'AUTO');
        await fileConfig.applyFileConfig();
        logger.info(`启动主进程 - PID: ${process.pid}`, 'CLUSTER');
        logger.info(`运行环境: ${NODE_ENV}`, 'CLUSTER');

        // 创建工作进程
        for (let i = 0; i < instances; i++) {
            const worker = cluster.fork();
            logger.info(`启动工作进程 ${i + 1}/${instances} - PID: ${worker.process.pid}`, 'CLUSTER');
        }

    // 监听工作进程退出
    cluster.on('exit', (worker, code, signal) => {
      logger.error(`工作进程 ${worker.process.pid} 已退出 - 退出码: ${code}, 信号: ${signal}`, 'CLUSTER')

      // 自动重启工作进程
      if (!worker.exitedAfterDisconnect) {
        logger.info('正在重启工作进程...', 'CLUSTER')
        const newWorker = cluster.fork()
        logger.info(`新工作进程已启动 - PID: ${newWorker.process.pid}`, 'CLUSTER')
      }
    })

    // 监听工作进程在线
    cluster.on('online', (worker) => {
      logger.info(`工作进程 ${worker.process.pid} 已上线`, 'CLUSTER')
    })

    // 监听工作进程断开连接
    cluster.on('disconnect', (worker) => {
      logger.warn(`工作进程 ${worker.process.pid} 已断开连接`, 'CLUSTER')
    })

    // 优雅关闭处理
    process.on('SIGTERM', () => {
      logger.info('收到SIGTERM信号，正在优雅关闭...', 'CLUSTER')
      cluster.disconnect(() => {
        process.exit(0)
      })
    })

    process.on('SIGINT', () => {
      logger.info('收到SIGINT信号，正在优雅关闭...', 'CLUSTER')
      cluster.disconnect(() => {
        process.exit(0)
      })
    })

  } else {
    // 工作进程逻辑
    logger.info(`工作进程启动 - PID: ${process.pid}`, 'WORKER')
    require('./server.js')

    // 工作进程优雅关闭处理
    process.on('SIGTERM', () => {
      logger.info(`工作进程 ${process.pid} 收到SIGTERM信号，正在关闭...`, 'WORKER')
      process.exit(0)
    })

    process.on('SIGINT', () => {
      logger.info(`工作进程 ${process.pid} 收到SIGINT信号，正在关闭...`, 'WORKER');
      process.exit(0);
    });
  }
}
})();
