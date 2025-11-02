const fs = require('fs').promises;
const path = require('path');
const { logger } = require('./logger');
const dataPersistence = require('./data-persistence');

const DATA_DIR = path.join(__dirname, '../../data');
const RELOAD_ENV_FILE = path.join(DATA_DIR, 'reload-env');
const ADD_FILE = path.join(DATA_DIR, 'add');
const SET_ENV_FILE = path.join(DATA_DIR, 'set-env');

class FileConfig {
    async applyFileConfig() {
        await this.handleReloadEnv();
        await this.handleAdd();
    }

    async handleReloadEnv() {
        try {
            await fs.access(RELOAD_ENV_FILE);
            logger.info('检测到 reload-env 文件，正在处理...', 'FILE_CONFIG', '📝');

            const content = await fs.readFile(RELOAD_ENV_FILE, 'utf8');
            const lines = content.split(/\r?\n/).map(line => line.trim().toLowerCase());

            const reloadAll = lines.length === 0 || lines.includes('') || (lines.includes('proxy') && (lines.includes('auth') || lines.includes('accounts')));

            if (reloadAll || lines.includes('proxy')) {
                await this.reloadProxies();
            }

            if (reloadAll || lines.includes('auth') || lines.includes('accounts')) {
                await this.reloadAccounts();
            }

            await fs.unlink(RELOAD_ENV_FILE);
            logger.success('reload-env 文件处理完毕并已删除', 'FILE_CONFIG');
        } catch (error) {
            if (error.code !== 'ENOENT') {
                logger.error('处理 reload-env 文件失败', 'FILE_CONFIG', '', error);
            }
        }
    }

    async handleAdd() {
        try {
            await fs.access(ADD_FILE);
            logger.info('检测到 add 文件，正在处理...', 'FILE_CONFIG', '📝');
            const accountManager = require('./account');
            const content = await fs.readFile(ADD_FILE, 'utf8');
            const lines = content.split(/\r?\n/);

            for (const line of lines) {
                const [key, ...values] = line.split('=');
                const value = values.join('=').trim();
                if (key && value) {
                    await this.addConfig(key.trim(), value, accountManager);
                }
            }

            await fs.unlink(ADD_FILE);
            logger.success('add 文件处理完毕并已删除', 'FILE_CONFIG');
        } catch (error) {
            if (error.code !== 'ENOENT') {
                logger.error('处理 add 文件失败', 'FILE_CONFIG', '', error);
            }
        }
    }

    async reloadProxies() {
        logger.info('正在重新加载代理...', 'FILE_CONFIG');
        const proxyEnv = process.env.SOCKS5_PROXIES;
        if (proxyEnv) {
            const proxies = proxyEnv.split(/\r?\n|,/).map(proxy => proxy.trim()).filter(proxy => proxy.length > 0);
            const statuses = await dataPersistence.loadProxyStatuses();
            for (const proxy of proxies) {
                statuses[proxy] = 'untested';
            }
            await dataPersistence.saveProxyStatuses(statuses);
            logger.success('代理状态已重置为 untested', 'FILE_CONFIG');
        }
    }

    async reloadAccounts() {
        logger.info('正在重新加载账户...', 'FILE_CONFIG');
        const accountManager = require('./account');
        const accountsEnv = process.env.ACCOUNTS;
        if (accountsEnv) {
            const accounts = accountsEnv.split(',').map(item => {
                const [email, password] = item.split(':');
                return { email, password };
            });

            const existingAccounts = await dataPersistence.loadAccounts();
            const existingEmails = new Set(existingAccounts.map(acc => acc.email));

            for (const acc of accounts) {
                if (!existingEmails.has(acc.email)) {
                    logger.info(`正在添加新账户: ${acc.email}`, 'FILE_CONFIG');
                    await accountManager.addAccount(acc.email, acc.password);
                }
            }
        }
    }

    async addConfig(key, value, accountManager) {
        if (key.toUpperCase() === 'ACCOUNTS') {
            const [email, password] = value.split(':');
            if (email && password) {
                logger.info(`正在添加账户: ${email}`, 'FILE_CONFIG');
                await accountManager.addAccount(email, password);
            }
        }
    }
}

module.exports = new FileConfig();