const config = require('../config/index.js')
const dataPersistence = require('./data-persistence')
const TokenManager = require('./token-manager')
const AccountRotator = require('./account-rotator')
const { logger } = require('./logger')
/**
 * 账户管理器
 * 统一管理账户、令牌、模型等功能
 */
class Account {
    constructor() {
        // 初始化各个管理器
        this.dataPersistence = dataPersistence
        this.tokenManager = new TokenManager()
        this.accountRotator = new AccountRotator()

        // 账户数据
        this.accountTokens = []
        this.isInitialized = false

        // 配置信息
        this.defaultHeaders = config.defaultHeaders || {}

        // cli请求次数定时刷新器
        this.cliRequestNumberInterval = null
        this.cliDailyResetInterval = null

        // 代理管理器
        this.proxyManager = null;

        // 初始化
        this._initialize()
    }

    /**
     * 异步初始化
     * @private
     */
    async _initialize() {
        try {
            // 初始化 ProxyManager
            if (config.socks5Proxies.length > 0) {
                const ProxyManager = require('./proxy-manager');
                this.proxyManager = new ProxyManager(this.dataPersistence);

                const savedBindings = await this.dataPersistence.loadProxyBindings();
                const savedStatuses = await this.dataPersistence.loadProxyStatuses();
                await this.proxyManager.initialize(savedStatuses, savedBindings);
            } else {
                logger.info('未配置 SOCKS5 代理，将直接连接', 'PROXY');
            }

            // 加载账户信息
            await this.loadAccountTokens()

            // 为已加载的账户对象附加代理信息
            if (this.proxyManager) {
                this.accountTokens.forEach(acc => {
                    acc.proxy = this.proxyManager.getProxyForAccount(acc.email);
                });
            }

            // 设置定期刷新令牌
            if (config.autoRefresh) {
                this.refreshInterval = setInterval(
                    () => this.autoRefreshTokens(),
                    (config.autoRefreshInterval || 21600) * 1000 // 默认6小时
                )
            }

            this.isInitialized = true
            logger.success(`账户管理器初始化完成，共加载 ${this.accountTokens.length} 个账户`, 'ACCOUNT')
        } catch (error) {
            logger.error('账户管理器初始化失败', 'ACCOUNT', '', error)
        }
    }

    /**
     * 加载账户令牌数据
     * @returns {Promise<void>}
     */
    async loadAccountTokens() {
        try {
            this.accountTokens = await this.dataPersistence.loadAccounts()

            // 首次启动时，如果data.json为空，则从.env初始化
            if (this.accountTokens.length === 0 && process.env.ACCOUNTS) {
                logger.info('检测到首次启动，正在从 .env 初始化账户...', 'ACCOUNT');
                const accountsEnv = process.env.ACCOUNTS;
                const accounts = accountsEnv.split(',').map(item => {
                    const [email, password] = item.split(':');
                    return { email, password };
                });

                for (const acc of accounts) {
                    await this.addAccount(acc.email, acc.password);
                }
                logger.info(`成功从 .env 初始化 ${this.accountTokens.length} 个账户`, 'ACCOUNT');
            }

            // 如果是环境变量模式，需要进行登录获取令牌
            if (config.dataSaveMode === 'none' && this.accountTokens.length > 0) {
                await this._loginEnvironmentAccounts()
            }

            // 在验证Token之前，为所有没有代理的账户分配代理
            if (this.proxyManager) {
                for (const account of this.accountTokens) {
                    if (!account.proxy) {
                        const assignedProxy = await this.proxyManager.assignProxy(account.email);
                        if (assignedProxy) {
                            account.proxy = assignedProxy;
                            await this.dataPersistence.saveProxyBinding(account.email, assignedProxy);
                        }
                    }
                }
            }

            // 验证和清理无效令牌
            await this._validateAndCleanTokens()

            // 更新账户轮询器
            this.accountRotator.setAccounts(this.accountTokens)

            // 初始化 CLI 账户,随机初始化一个账号
            if (this.accountTokens.length > 0) {
                const randomIndex = Math.floor(Math.random() * this.accountTokens.length);
                const randomAccount = this.accountTokens[randomIndex];

                // 确保在记录日志前，为这个被选中的账户分配一个代理（如果它还没有）
                if (!randomAccount.proxy && this.proxyManager) {
                    const assignedProxy = this.proxyManager.assignProxy(randomAccount.email);
                    if (assignedProxy) {
                        randomAccount.proxy = assignedProxy;
                        await this.dataPersistence.saveProxyBinding(randomAccount.email, assignedProxy);
                    }
                }

                let randomAccountProxyHost = 'N/A';
                if (randomAccount.proxy) {
                    try {
                        const proxyUrl = new URL(randomAccount.proxy);
                        randomAccountProxyHost = proxyUrl.hostname;
                    } catch (e) { /* ignore */ }
                }
                logger.info(`初始化 CLI 账户, 随机初始化账号: ${randomAccount.email} (Proxy: ${randomAccountProxyHost})`, 'ACCOUNT');
                await this._initializeCliAccount(randomAccount);
            }

            // 设置cli定时器 每天00:00:00刷新请求次数
            this._setupDailyResetTimer()

            logger.success(`成功加载 ${this.accountTokens.length} 个账户`, 'ACCOUNT')
        } catch (error) {
            logger.error('加载账户令牌失败', 'ACCOUNT', '', error)
            this.accountTokens = []
        }
    }

    /**
     * 为环境变量模式的账户进行登录
     * @private
     */
    async _loginEnvironmentAccounts() {
        const loginPromises = this.accountTokens.map(async (account) => {
            if (!account.token && account.email && account.password) {
                if (this.proxyManager) {
                    const assignedProxy = this.proxyManager.assignProxy(account.email);
                    if (assignedProxy) {
                        account.proxy = assignedProxy;
                        logger.info(`为账户 ${account.email} 分配代理: ${assignedProxy}`, 'PROXY');
                        // 持久化代理绑定
                        await this.dataPersistence.saveProxyBinding(account.email, assignedProxy);
                    }
                }

                global.currentLoginProxy = account.proxy || null;
                const token = await this.tokenManager.login(account.email, account.password);
                global.currentLoginProxy = null;

                if (token) {
                    const decoded = this.tokenManager.validateToken(token);
                    if (decoded) {
                        account.token = token;
                        account.expires = decoded.exp;
                    }
                }
            }
            return account;
        });

        this.accountTokens = await Promise.all(loginPromises);
    }

    /**
     * 初始化CLI账户
     * @param {Object} account - 账户对象
     * @private
     */
    async _initializeCliAccount(account) {
        try {
            const cliManager = require('./cli.manager');
            const cliAccount = await cliManager.initCliAccount(account.token, account.proxy);

            if (cliAccount.access_token && cliAccount.refresh_token && cliAccount.expiry_date) {
                account.cli_info = {
                    access_token: cliAccount.access_token,
                    refresh_token: cliAccount.refresh_token,
                    expiry_date: cliAccount.expiry_date,
                    refresh_token_interval: setInterval(async () => {
                        try {
                            const refreshToken = await cliManager.refreshAccessToken({
                                access_token: account.cli_info.access_token,
                                refresh_token: account.cli_info.refresh_token,
                                expiry_date: account.cli_info.expiry_date,
                            }, account.proxy); // 传递代理
                            if (refreshToken.access_token && refreshToken.refresh_token && refreshToken.expiry_date) {
                                account.cli_info.access_token = refreshToken.access_token;
                                account.cli_info.refresh_token = refreshToken.refresh_token;
                                account.cli_info.expiry_date = refreshToken.expiry_date;
                                logger.info(`CLI账户 ${account.email} 令牌刷新成功`, 'CLI');
                            }
                        } catch (error) {
                            logger.error(`CLI账户 ${account.email} 令牌刷新失败`, 'CLI', '', error);
                        }
                    }, 1000 * 60 * 60 * 2),
                    request_number: 0,
                };
                logger.success(`CLI账户 ${account.email} 初始化成功`, 'CLI');
            } else {
                logger.error(`CLI账户 ${account.email} 初始化失败：无效的响应数据`, 'CLI');
            }
        } catch (error) {
            logger.error(`CLI账户 ${account.email} 初始化失败`, 'CLI', '', error);
        }
    }

    /**
     * 设置每日重置定时器
     * @private
     */
    _setupDailyResetTimer() {
        logger.info('设置CLI请求次数每日重置定时器', 'CLI')

        // 计算到下一天00:00:00的毫秒数
        const now = new Date()
        const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0)
        const timeDiff = tomorrow.getTime() - now.getTime()

        logger.info(`距离下次重置还有 ${Math.round(timeDiff / 1000 / 60)} 分钟`, 'CLI')

        // 首次执行使用setTimeout
        this.cliRequestNumberInterval = setTimeout(() => {
            // 重置所有CLI账户的请求次数
            this._resetCliRequestNumbers()

            // 设置每24小时执行一次的定时器
            this.cliDailyResetInterval = setInterval(() => {
                this._resetCliRequestNumbers()
            }, 24 * 60 * 60 * 1000)
        }, timeDiff)
    }

    /**
     * 重置CLI请求次数
     * @private
     */
    _resetCliRequestNumbers() {
        const cliAccounts = this.accountTokens.filter(account => account.cli_info)
        cliAccounts.forEach(account => {
            account.cli_info.request_number = 0
        })
        logger.info(`已重置 ${cliAccounts.length} 个CLI账户的请求次数`, 'CLI')
    }

    /**
     * 验证和清理无效令牌
     * @private
     */
    async _validateAndCleanTokens() {
        const validAccounts = []

        for (const account of this.accountTokens) {
            if (account.token && this.tokenManager.validateToken(account.token)) {
                validAccounts.push(account)
            } else if (account.email && account.password) {
                // 尝试重新登录
                logger.info(`令牌无效，尝试重新登录: ${account.email}`, 'TOKEN', '🔄')
                
                // 为账户分配代理
                let assignedProxy = null;
                if (this.proxyManager) {
                    assignedProxy = await this.proxyManager.assignProxy(account.email);
                    account.proxy = assignedProxy; // 将代理信息写入账户对象
                    if (assignedProxy) {
                        // 持久化代理绑定
                        await this.dataPersistence.saveProxyBinding(account.email, assignedProxy);
                    }
                }
                
                // 在登录前设置当前代理，用于日志显示
                global.currentLoginProxy = assignedProxy;
                const newToken = await this.tokenManager.login(account.email, account.password);
                // 登录后清除全局代理变量
                global.currentLoginProxy = null;

                if (newToken) {
                    const decoded = this.tokenManager.validateToken(newToken)
                    if (decoded) {
                        account.token = newToken
                        account.expires = decoded.exp
                        validAccounts.push(account)
                    }
                }
            }
        }

        this.accountTokens = validAccounts
    }


    /**
     * 自动刷新即将过期的令牌
     * @param {number} thresholdHours - 过期阈值（小时）
     * @returns {Promise<number>} 成功刷新的令牌数量
     */
    async autoRefreshTokens(thresholdHours = 24) {
        if (!this.isInitialized) {
            logger.warn('账户管理器尚未初始化，跳过自动刷新', 'TOKEN')
            return 0
        }

        logger.info('开始自动刷新令牌...', 'TOKEN', '🔄')

        // 获取需要刷新的账户
        const needsRefresh = this.accountTokens.filter(account =>
            this.tokenManager.isTokenExpiringSoon(account.token, thresholdHours)
        )

        if (needsRefresh.length === 0) {
            logger.info('没有需要刷新的令牌', 'TOKEN')
            return 0
        }

        logger.info(`发现 ${needsRefresh.length} 个令牌需要刷新`, 'TOKEN')

        let successCount = 0
        let failedCount = 0

        // 逐个刷新账户，每次成功后立即保存
        for (const account of needsRefresh) {
            try {
                const updatedAccount = await this.tokenManager.refreshToken(account)
                if (updatedAccount) {
                    // 立即更新内存中的账户数据
                    const index = this.accountTokens.findIndex(acc => acc.email === account.email)
                    if (index !== -1) {
                        this.accountTokens[index] = updatedAccount
                    }

                    // 立即保存到持久化存储
                    await this.dataPersistence.saveAccount(account.email, {
                        password: updatedAccount.password,
                        token: updatedAccount.token,
                        expires: updatedAccount.expires
                    })

                    // 重置失败计数
                    this.accountRotator.resetFailures(account.email)
                    successCount++

                    logger.info(`账户 ${account.email} 令牌刷新并保存成功 (${successCount}/${needsRefresh.length})`, 'TOKEN', '✅')
                } else {
                    // 记录失败的账户
                    this.accountRotator.recordFailure(account.email)
                    failedCount++
                    logger.error(`账户 ${account.email} 令牌刷新失败 (${failedCount} 个失败)`, 'TOKEN', '❌')
                }
            } catch (error) {
                this.accountRotator.recordFailure(account.email)
                failedCount++
                logger.error(`账户 ${account.email} 刷新过程中出错`, 'TOKEN', '', error)
            }

            // 添加延迟避免请求过于频繁
            await this._delay(1000)
        }

        // 更新轮询器
        this.accountRotator.setAccounts(this.accountTokens)

        logger.success(`令牌刷新完成: 成功 ${successCount} 个，失败 ${failedCount} 个`, 'TOKEN')
        return successCount
    }

    /**
     * 获取可用的账户对象
     * @returns {Object|null} 账户对象或null
     */
    getNextAccount() {
        if (!this.isInitialized) {
            logger.warn('账户管理器尚未初始化完成', 'ACCOUNT');
            return null;
        }

        if (this.accountTokens.length === 0) {
            logger.error('没有可用的账户', 'ACCOUNT');
            return null;
        }

        const account = this.accountRotator.getNextAccount();
        if (!account) {
            logger.error('所有账户都不可用', 'ACCOUNT');
        }

        return account;
    }

    /**
     * 根据邮箱获取特定账户对象
     * @param {string} email - 邮箱地址
     * @returns {Object|null} 账户对象或null
     */
    getAccountByEmail(email) {
        return this.accountRotator.getAccountByEmail(email);
    }

    /**
     * 保存更新后的账户数据
     * @param {Array} updatedAccounts - 更新后的账户列表
     * @private
     */
    async _saveUpdatedAccounts(updatedAccounts) {
        try {
            for (const account of updatedAccounts) {
                await this.dataPersistence.saveAccount(account.email, {
                    password: account.password,
                    token: account.token,
                    expires: account.expires
                })
            }
        } catch (error) {
            logger.error('保存更新后的账户数据失败', 'ACCOUNT', '', error)
        }
    }

    /**
     * 手动刷新指定账户的令牌
     * @param {string} email - 邮箱地址
     * @returns {Promise<boolean>} 刷新是否成功
     */
    async refreshAccountToken(email) {
        const account = this.accountTokens.find(acc => acc.email === email)
        if (!account) {
            logger.error(`未找到邮箱为 ${email} 的账户`, 'ACCOUNT')
            return false
        }

        const updatedAccount = await this.tokenManager.refreshToken(account)
        if (updatedAccount) {
            // 更新内存中的数据
            const index = this.accountTokens.findIndex(acc => acc.email === email)
            if (index !== -1) {
                this.accountTokens[index] = updatedAccount
            }

            // 保存到持久化存储
            await this.dataPersistence.saveAccount(email, {
                password: updatedAccount.password,
                token: updatedAccount.token,
                expires: updatedAccount.expires
            })

            // 重置失败计数
            this.accountRotator.resetFailures(email)

            return true
        }

        return false
    }

    // 更新销毁方法，清除定时器
    destroy() {
        if (this.saveInterval) {
            clearInterval(this.saveInterval)
        }
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval)
        }
    }




    /**
     * 生成 Markdown 表格
     * @param {Array} websites - 网站信息数组
     * @param {string} mode - 模式 ('table' 或 'text')
     * @returns {Promise<string>} Markdown 字符串
     */
    async generateMarkdownTable(websites, mode) {
        // 输入校验
        if (!Array.isArray(websites) || websites.length === 0) {
            return ''
        }

        let markdown = ''
        if (mode === 'table') {
            markdown += '| **序号** | **网站URL** | **来源** |\n'
            markdown += '|:---|:---|:---|\n'
        }

        // 默认值
        const DEFAULT_TITLE = '未知标题'
        const DEFAULT_URL = 'https://www.baidu.com'
        const DEFAULT_HOSTNAME = '未知来源'

        // 表格内容
        websites.forEach((site, index) => {
            const { title, url, hostname } = site
            // 处理字段值，若为空则使用默认值
            const urlCell = `[${title || DEFAULT_TITLE}](${url || DEFAULT_URL})`
            const hostnameCell = hostname || DEFAULT_HOSTNAME
            if (mode === 'table') {
                markdown += `| ${index + 1} | ${urlCell} | ${hostnameCell} |\n`
            } else {
                markdown += `[${index + 1}] ${urlCell} | 来源: ${hostnameCell}\n`
            }
        })

        return markdown
    }



    /**
     * 获取所有账户信息
     * @returns {Array} 账户列表
     */
    getAllAccountKeys() {
        return this.accountTokens
    }

    /**
     * 用户登录（委托给 TokenManager）
     * @param {string} email - 邮箱
     * @param {string} password - 密码
     * @returns {Promise<string|null>} 令牌或null
     */
    async login(email, password) {
        return await this.tokenManager.login(email, password)
    }

    /**
     * 获取账户健康状态统计
     * @returns {Object} 健康状态统计
     */
    getHealthStats() {
        const tokenStats = this.tokenManager.getTokenHealthStats(this.accountTokens)
        const rotatorStats = this.accountRotator.getStats()

        return {
            accounts: tokenStats,
            rotation: rotatorStats,
            initialized: this.isInitialized
        }
    }

    /**
     * 记录账户使用失败
     * @param {string} email - 邮箱地址
     */
    recordAccountFailure(email) {
        this.accountRotator.recordFailure(email)
    }

    /**
     * 重置账户失败计数
     * @param {string} email - 邮箱地址
     */
    resetAccountFailures(email) {
        this.accountRotator.resetFailures(email)
    }

    /**
     * 添加新账户
     * @param {string} email - 邮箱
     * @param {string} password - 密码
     * @returns {Promise<boolean>} 添加是否成功
     */
    async addAccount(email, password) {
        if (this.accountTokens.some(acc => acc.email === email)) {
            logger.warn(`账户 ${email} 已存在`, 'ACCOUNT');
            return false;
        }

        const MAX_PROXY_RETRIES = 3;
        const MAX_ATTEMPTS_PER_PROXY = 2;
        const RETRY_DELAY_MS = 20000; // 20秒

        for (let proxyAttempt = 1; proxyAttempt <= MAX_PROXY_RETRIES; proxyAttempt++) {
            let assignedProxy = null;
            if (this.proxyManager) {
                logger.info(`[代理尝试 ${proxyAttempt}/${MAX_PROXY_RETRIES}] 正在为账户 ${email} 分配代理...`, 'PROXY');
                // 强制分配一个新代理，除非是第一次
                assignedProxy = await this.proxyManager.assignProxy(email, proxyAttempt > 1);
                if (assignedProxy) {
                    await this.dataPersistence.saveProxyBinding(email, assignedProxy);
                    await this.proxyManager.persistStatuses();
                } else {
                    logger.warn(`[代理尝试 ${proxyAttempt}/${MAX_PROXY_RETRIES}] 未能为 ${email} 分配代理`, 'PROXY');
                }
            }

            for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_PROXY; attempt++) {
                logger.info(`[登录尝试 ${attempt}/${MAX_ATTEMPTS_PER_PROXY}] 正在使用代理 ${assignedProxy || 'N/A'} 尝试登录 ${email}...`, 'ACCOUNT');
                const newAccount = await this._attemptLogin(email, password, assignedProxy);

                if (newAccount) {
                    this.accountTokens.push(newAccount);
                    await this.dataPersistence.saveAccount(email, newAccount);
                    this.accountRotator.setAccounts(this.accountTokens);
                    logger.success(`成功添加账户: ${email} (使用代理: ${assignedProxy || 'N/A'})`, 'ACCOUNT');
                    return true;
                }

                // 如果登录失败
                if (attempt < MAX_ATTEMPTS_PER_PROXY) {
                    logger.info(`登录失败，将在 ${RETRY_DELAY_MS / 1000} 秒后使用同一代理重试...`, 'ACCOUNT');
                    await this._delay(RETRY_DELAY_MS);
                }
            }

            // 如果一个代理的所有尝试都失败了
            if (assignedProxy && this.proxyManager) {
                logger.error(`使用代理 ${assignedProxy} 的所有登录尝试均失败，将其标记为失败`, 'PROXY');
                this.proxyManager.markProxyAsFailed(assignedProxy);
                await this.proxyManager.persistStatuses();
            }

            if (proxyAttempt < MAX_PROXY_RETRIES) {
                logger.info('将在更换代理后重试...', 'PROXY');
            }
        }

        logger.error(`为账户 ${email} 尝试了 ${MAX_PROXY_RETRIES} 个代理后，所有登录尝试均失败。添加账户失败。`, 'ACCOUNT');
        return false;
    }

    /**
     * 移除账户
     * @param {string} email - 邮箱地址
     * @returns {Promise<boolean>} 移除是否成功
     */
    async removeAccount(email) {
        try {
            const index = this.accountTokens.findIndex(acc => acc.email === email)
            if (index === -1) {
                logger.warn(`账户 ${email} 不存在`, 'ACCOUNT')
                return false
            }

            // 从内存中移除
            this.accountTokens.splice(index, 1)

            // 更新轮询器
            this.accountRotator.setAccounts(this.accountTokens)

            logger.success(`成功移除账户: ${email}`, 'ACCOUNT')
            return true
        } catch (error) {
            logger.error(`移除账户失败 (${email})`, 'ACCOUNT', '', error)
            return false
        }
    }

    /**
     * 删除账户（向后兼容）
     * @param {string} email - 邮箱地址
     * @returns {boolean} 删除是否成功
     */
    deleteAccount(email) {
        const index = this.accountTokens.findIndex(t => t.email === email)
        if (index !== -1) {
            this.accountTokens.splice(index, 1)
            this.accountRotator.setAccounts(this.accountTokens)
            return true
        }
        return false
    }

    /**
     * 为指定账户初始化CLI信息（公共方法）
     * @param {Object} account - 账户对象
     * @returns {Promise<boolean>} 初始化是否成功
     */
    async initializeCliForAccount(account) {
        if (!account) {
            logger.error('账户对象不能为空', 'CLI')
            return false
        }

        try {
            await this._initializeCliAccount(account)
            return true
        } catch (error) {
            logger.error(`为账户 ${account.email} 初始化CLI失败`, 'CLI', '', error)
            return false
        }
    }

    /**
     * 延迟函数
     * @param {number} ms - 延迟毫秒数
     * @private
     */
    async _delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms))
    }

    /**
     * 尝试使用指定的代理进行登录
     * @param {string} email - 邮箱
     * @param {string} password - 密码
     * @param {string|null} proxy - 代理URL
     * @returns {Promise<Object|null>} 成功则返回账户对象，失败则返回null
     * @private
     */
    async _attemptLogin(email, password, proxy) {
        try {
            global.currentLoginProxy = proxy;
            const token = await this.tokenManager.login(email, password);
            global.currentLoginProxy = null;

            if (!token) {
                logger.warn(`使用代理 ${proxy || 'N/A'} 登录 ${email} 失败：未能获取令牌`, 'ACCOUNT');
                return null;
            }

            const decoded = this.tokenManager.validateToken(token);
            if (!decoded) {
                logger.warn(`使用代理 ${proxy || 'N/A'} 登录 ${email} 失败：令牌无效`, 'ACCOUNT');
                return null;
            }

            return {
                email,
                password,
                token,
                expires: decoded.exp,
                proxy,
            };
        } catch (error) {
            global.currentLoginProxy = null;
            logger.error(`使用代理 ${proxy || 'N/A'} 登录 ${email} 时发生异常`, 'ACCOUNT', '', error);
            return null;
        }
    }

    /**
     * 清理资源
     */
    destroy() {
        // 清理自动刷新定时器
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval)
            this.refreshInterval = null
        }

        // 清理CLI请求次数重置定时器
        if (this.cliRequestNumberInterval) {
            clearTimeout(this.cliRequestNumberInterval)
            this.cliRequestNumberInterval = null
        }

        if (this.cliDailyResetInterval) {
            clearInterval(this.cliDailyResetInterval)
            this.cliDailyResetInterval = null
        }

        // 清理所有CLI账户的刷新定时器
        this.accountTokens.forEach(account => {
            if (account.cli_info && account.cli_info.refresh_token_interval) {
                clearInterval(account.cli_info.refresh_token_interval)
                account.cli_info.refresh_token_interval = null
            }
        })

        this.accountRotator.reset()
        logger.info('账户管理器已清理资源', 'ACCOUNT', '🧹')
    }

    /**
     * 处理网络请求失败，检查代理是否失效并重新分配
     * @param {string} email - 账户邮箱
     * @param {string} proxyUrl - 当前使用的代理URL
     */
    async handleNetworkFailure(email, proxyUrl) {
        if (!this.proxyManager) {
            logger.warn('代理管理器未初始化，无法处理网络失败', 'PROXY')
            return
        }

        logger.info(`检测到账户 ${email} 使用代理 ${proxyUrl} 请求失败，检查代理状态...`, 'PROXY')
        // 标记代理为失败
        this.proxyManager.markProxyAsFailed(proxyUrl)

        // 尝试为账户重新分配一个新代理
        const newProxy = await this.proxyManager.assignProxy(email, true) // forceNew = true
        if (newProxy) {
            // 解析新代理URL以获取IP
            let newProxyHostForLog = newProxy;
            try {
                const proxyUrl = new URL(newProxy);
                newProxyHostForLog = proxyUrl.hostname;
            } catch (e) { /* ignore */ }
            logger.success(`账户 ${email} (${newProxyHostForLog}) 登录成功`, 'PROXY')
            // 保存新的绑定关系
            await this.dataPersistence.saveProxyBinding(email, newProxy)
        } else {
            logger.error(`账户 ${email} 重新分配代理失败，当前无可用代理`, 'PROXY')
        }
    }

    /**
     * 获取代理状态信息
     * @returns {Array} 代理状态数组
     */
    getProxyStatus() {
        if (!this.proxyManager) {
            return []
        }
        return this.proxyManager.getProxyStatus()
    }

    /**
     * 获取代理分配信息
     * @returns {Map} 账户到代理的映射
     */
    getProxyAssignments() {
        if (!this.proxyManager) {
            return new Map()
        }
        return this.proxyManager.getProxyAssignments()
    }

}

if (!(process.env.API_KEY || config.apiKey)) {
    logger.error('请务必设置 API_KEY 环境变量', 'CONFIG', '⚙️')
    process.exit(1)
}

const accountManager = new Account()

// 添加进程退出时的清理
process.on('exit', () => {
    if (accountManager) {
        accountManager.destroy()
    }
})

// 处理意外退出
process.on('SIGINT', () => {
    if (accountManager) {
        accountManager.destroy()
    }
    process.exit(0)
})


module.exports = accountManager