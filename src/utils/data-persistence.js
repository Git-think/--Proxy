const fs = require('fs').promises;
const path = require('path');
const { logger } = require('./logger');
const redis = require('./redis');

class DataPersistence {
    constructor() {
        this.mode = process.env.DATA_SAVE_MODE || 'none';
        this.filePath = path.join(__dirname, '../../data/data.json');
        this.cache = null;
        this.isInitialized = false;
        this.initializationPromise = this._initialize();
    }

    async _initialize() {
        if (this.isInitialized) {
            return;
        }
        try {
            // 核心逻辑只执行一次
            if (this.mode === 'file') {
                try {
                    const data = await fs.readFile(this.filePath, 'utf8');
                    this.cache = JSON.parse(data);
                } catch (error) {
                    if (error.code === 'ENOENT') {
                        logger.info('数据文件不存在，正在创建默认文件...', 'FILE');
                        const defaultData = this._getDefaultData();
                        await this._saveData(defaultData); // _saveData 内部会设置缓存
                        logger.success('默认数据文件创建成功', 'FILE');
                    } else {
                        throw error; // 抛出其他读取错误
                    }
                }
            } else if (this.mode === 'redis') {
                const data = await redis.get('qwen_proxy_data');
                this.cache = data ? JSON.parse(data) : this._getDefaultData();
            } else {
                this.cache = this._getDefaultData();
            }

            this.isInitialized = true;
            logger.info(`数据持久化模块初始化完成 (模式: ${this.mode})`, 'DATA');
        } catch (error) {
            logger.error('数据持久化模块初始化失败', 'DATA', '', error);
            this.isInitialized = false; // 确保失败后可以重试
            throw error;
        }
    }

    async _getData() {
        await this.initializationPromise;
        return this.cache || this._getDefaultData();
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
