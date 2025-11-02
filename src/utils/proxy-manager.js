const { SocksProxyAgent } = require('socks-proxy-agent');
const axios = require('axios');
const config = require('../config/index.js');
const { logger } = require('./logger');

class ProxyManager {
  constructor(dataPersistence) {
    this.proxies = new Map(); // Key: proxyUrl, Value: { url, status, assignedAccounts }
    this.proxyAssignment = new Map(); // Key: email, Value: proxyUrl
    this.dataPersistence = dataPersistence;

    config.socks5Proxies.forEach(proxyUrl => {
      this.proxies.set(proxyUrl, {
        url: proxyUrl,
        status: 'untested', // 'untested', 'available', 'failed'
        assignedAccounts: new Set(),
      });
    });
  }

  async initialize(savedStatuses = {}, savedBindings = {}) {
    // Load statuses
    for (const [proxyUrl, status] of Object.entries(savedStatuses)) {
      if (this.proxies.has(proxyUrl)) {
        this.proxies.get(proxyUrl).status = status;
      }
    }

    // Load bindings
    for (const [email, proxyUrl] of Object.entries(savedBindings)) {
      if (this.proxies.has(proxyUrl)) {
        this.proxyAssignment.set(email, proxyUrl);
        this.proxies.get(proxyUrl).assignedAccounts.add(email);
      }
    }
    logger.success(`代理管理器初始化完成，加载了 ${this.proxies.size} 个代理`, 'PROXY');
  }

  async _testProxy(proxyUrl) {
    const proxyData = this.proxies.get(proxyUrl);
    if (!proxyData) return false;

    logger.info(`正在测试代理: ${proxyUrl}`, 'PROXY');
    try {
      const agent = new SocksProxyAgent(proxyUrl);
      await axios.get('https://www.google.com/generate_204', {
        httpAgent: agent,
        httpsAgent: agent,
        timeout: 10000,
        validateStatus: (status) => status === 204,
      });
      proxyData.status = 'available';
      logger.info(`代理 ${proxyUrl} 测试成功`, 'PROXY');
      return true;
    } catch (error) {
      proxyData.status = 'failed';
      logger.error(`代理 ${proxyUrl} 测试失败: ${error.message}`, 'PROXY');
      return false;
    } finally {
      await this.persistStatuses();
    }
  }

  async assignProxy(email, forceNew = false) {
    if (this.proxyAssignment.has(email) && !forceNew) {
      return this.proxyAssignment.get(email);
    }

    // 如果强制刷新，先解除旧的绑定
    if (this.proxyAssignment.has(email)) {
        const oldProxyUrl = this.proxyAssignment.get(email);
        const oldProxyData = this.proxies.get(oldProxyUrl);
        if (oldProxyData) {
            oldProxyData.assignedAccounts.delete(email);
        }
        this.proxyAssignment.delete(email);
    }

    // P1: Find and verify an unused 'available' proxy
    const availableUnusedProxies = [...this.proxies.values()].filter(p => p.status === 'available' && p.assignedAccounts.size === 0);
    for (const proxy of availableUnusedProxies) {
      if (await this._testProxy(proxy.url)) {
        return this._bindProxyToAccount(email, proxy);
      }
    }

    // P2: Find and test an 'untested' proxy
    const untestedProxies = [...this.proxies.values()].filter(p => p.status === 'untested');
    if (untestedProxies.length > 0) {
        untestedProxies.sort(() => Math.random() - 0.5); // Randomize
        for (const proxy of untestedProxies) {
            if (await this._testProxy(proxy.url)) {
                return this._bindProxyToAccount(email, proxy);
            }
        }
    }

    // P3: Find and re-test a 'failed' proxy
    const failedProxies = [...this.proxies.values()].filter(p => p.status === 'failed');
    if (failedProxies.length > 0) {
        failedProxies.sort(() => Math.random() - 0.5); // Randomize
        for (const proxy of failedProxies) {
            if (await this._testProxy(proxy.url)) {
                return this._bindProxyToAccount(email, proxy);
            }
        }
    }
    
    // P4: Find, verify and share an 'available' proxy
    const availableProxies = [...this.proxies.values()].filter(p => p.status === 'available');
    if (availableProxies.length > 0) {
        availableProxies.sort((a, b) => a.assignedAccounts.size - b.assignedAccounts.size);
        for (const proxy of availableProxies) {
            if (await this._testProxy(proxy.url)) {
                return this._bindProxyToAccount(email, proxy);
            }
        }
    }

    logger.error(`没有可用的代理供账户 ${email} 使用`, 'PROXY');
    return null;
  }

  _bindProxyToAccount(email, proxyData) {
    this.proxyAssignment.set(email, proxyData.url);
    proxyData.assignedAccounts.add(email);
    this.dataPersistence.saveProxyBinding(email, proxyData.url);
    logger.info(`为账户 ${email} 分配代理: ${proxyData.url}`, 'PROXY');
    return proxyData.url;
  }

  getProxyForAccount(email) {
    return this.proxyAssignment.get(email) || null;
  }

  async markProxyAsFailed(proxyUrl) {
    const proxyData = this.proxies.get(proxyUrl);
    if (proxyData) {
      proxyData.status = 'failed';
      await this.persistStatuses();
      logger.warn(`代理 ${proxyUrl} 已被标记为失败`, 'PROXY');
    }
  }

  async persistStatuses() {
    const statuses = {};
    for (const [url, data] of this.proxies.entries()) {
      statuses[url] = data.status;
    }
    await this.dataPersistence.saveProxyStatuses(statuses);
  }
}

module.exports = ProxyManager;