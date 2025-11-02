const fs = require('fs').promises;
const path = require('path');
const { logger } = require('./logger');
const redis = require('./redis');

class DataPersistence {
    constructor() {
        // 直接从环境变量初始化，打破循环依赖
        this.mode = process.env.DATA_SAVE_MODE || 'none';
        this.filePath = path.join(__dirname, '../../data/data.json');
        this.cache = null;
        this._initializationPromise = this._initialize();
    }

    async _initialize() {
        try {
            await this._getData(); // 预加载数据
            logger.info(`数据持久化模块初始化完成 (模式: ${this.mode})`, 'DATA');
        } catch (error) {
            logger.error('数据持久化模块初始化失败', 'DATA', '', error);
            // 在这种情况下，我们可能希望进程退出或进入降级模式
            throw error; // 抛出错误以在顶层捕获
        }
    }

    async _getData() {
        if (this.cache) {
            return this.cache;
        }

        try {
            if (this.mode === 'file') {
                const data = await fs.readFile(this.filePath, 'utf8');
                this.cache = JSON.parse(data);
                return this.cache;
            } else if (this.mode === 'redis') {
                const data = await redis.get('qwen_proxy_data');
                this.cache = data ? JSON.parse(data) : this._getDefaultData();
                return this.cache;
            }
        } catch (error) {
            if (error.code === 'ENOENT') {
                logger.info('数据文件不存在，正在创建默认文件...', 'FILE');
                await this._saveData(this._getDefaultData());
                logger.success('默认数据文件创建成功', 'FILE');
                return this._getDefaultData();
            }
            logger.error('加载数据失败', 'DATA', '', error);
        }
        return this._getDefaultData();
    }

    async _saveData(data) {
        this.cache = data;
        try {
            if (this.mode === 'file') {
                await fs.mkdir(path.dirname(this.filePath), { recursive: true });
                await fs.writeFile(this.filePath, JSON.stringify(data, null, 2), 'utf8');
            } else if (this.mode === 'redis') {
                await redis.set('qwen_proxy_data', JSON.stringify(data));
            }
        } catch (error) {
            logger.error('保存数据失败', 'DATA', '', error);
        }
    }

    _getDefaultData() {
        return {
            accounts: [],
            proxyBindings: {},
            proxyStatuses: {},
            settings: {} // 新增 settings 对象
        };
    }

    async loadAccounts() {
        const data = await this._getData();
        return data.accounts || [];
    }

    async saveAccount(email, accountData) {
        const data = await this._getData();
        const index = data.accounts.findIndex(acc => acc.email === email);
        if (index !== -1) {
            data.accounts[index] = { ...data.accounts[index], ...accountData };
        } else {
            data.accounts.push({ email, ...accountData });
        }
        await this._saveData(data);
    }

    async loadProxyBindings() {
        const data = await this._getData();
        return data.proxyBindings || {};
    }

    async saveProxyBinding(email, proxyUrl) {
        const data = await this._getData();
        data.proxyBindings[email] = proxyUrl;
        await this._saveData(data);
    }

    async loadProxyStatuses() {
        const data = await this._getData();
        return data.proxyStatuses || {};
    }

    async saveProxyStatuses(statuses) {
        const data = await this._getData();
        data.proxyStatuses = statuses;
        await this._saveData(data);
    }

    async loadSettings() {
        const data = await this._getData();
        return data.settings || {};
    }

    async saveSetting(key, value) {
        const data = await this._getData();
        if (!data.settings) {
            data.settings = {};
        }
        data.settings[key] = value;
        await this._saveData(data);
    }
}

const instance = new DataPersistence();
module.exports = instance;
