const axios = require('axios')
const config = require('../config/index.js')
const accountManager = require('./account.js')
const { logger } = require('./logger')
const { SocksProxyAgent } = require('socks-proxy-agent')


/**
 * 发送聊天请求
 * @param {Object} body - 请求体
 * @param {number} retryCount - 当前重试次数
 * @param {string} lastUsedEmail - 上次使用的邮箱（用于错误记录）
 * @returns {Promise<Object>} 响应结果
 */
const sendChatRequest = async (body) => {
    const MAX_RETRIES = 3;
    let lastError = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        const accountInfo = accountManager.getNextAccount();
        if (!accountInfo) {
            logger.error('无法获取有效的账户信息', 'ACCOUNT');
            return { status: false, response: null };
        }

        const { token: currentToken, email } = accountInfo;
        // 每次循环都重新获取代理，因为它可能在 handleNetworkFailure 中被更新
        const proxy = accountManager.getProxyForAccount(email);

        try {
            // 构建请求配置
            const requestConfig = {
                headers: {
                    'authorization': `Bearer ${currentToken}`,
                    'Content-Type': 'application/json',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0',
                    "Connection": "keep-alive",
                    "Accept": "*/*",
                    "Accept-Encoding": "gzip, deflate, br",
                    ...(config.ssxmodItna && { 'Cookie': `ssxmod_itna=${config.ssxmodItna};ssxmod_itna2=${config.ssxmodItna2}` })
                },
                responseType: body.stream ? 'stream' : 'json',
                timeout: 60 * 1000,
            };

            if (proxy) {
                try {
                    const agent = new SocksProxyAgent(proxy);
                    requestConfig.httpAgent = agent;
                    requestConfig.httpsAgent = agent;
                } catch (agentError) {
                    logger.error(`为 sendChatRequest 创建代理Agent失败 (${proxy}): ${agentError.message}`, 'PROXY');
                }
            }

            const chat_id = await generateChatID(currentToken, body.model, email, proxy);
            if (!chat_id) {
                // generateChatID 内部已经处理了代理失败和重试，如果仍然失败，则终止
                logger.error('无法生成 chat_id，终止聊天请求', 'CHAT');
                return { status: false, response: null };
            }

            logger.network(`发送聊天请求 (账户: ${email}, 尝试: ${attempt}/${MAX_RETRIES})`, 'REQUEST');
            const response = await axios.post(`https://chat.qwen.ai/api/v2/chat/completions?chat_id=${chat_id}`, {
                ...body,
                chat_id: chat_id
            }, requestConfig);

            if (response.status === 200) {
                return {
                    currentToken: currentToken,
                    status: true,
                    response: response.data
                };
            }
            // 对于非200的状态码，也视为一种需要记录的错误
            lastError = new Error(`Request failed with status code ${response.status}`);


        } catch (error) {
            lastError = error; // 保存当前错误
            let proxyHostForLog = proxy || 'none';
            if (proxy) {
                try {
                    const proxyUrl = new URL(proxy);
                    proxyHostForLog = proxyUrl.hostname;
                } catch (e) { /* ignore */ }
            }
            logger.error(`发送聊天请求失败 (账户: ${email} (${proxyHostForLog}), 尝试: ${attempt}/${MAX_RETRIES}): ${error.message}`, 'REQUEST');

            const networkErrorCodes = ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'ENETUNREACH', 'EAI_AGAIN'];
            if (proxy && (networkErrorCodes.includes(error.code) || error.message.includes('timeout') || error.message.includes('ECONN') || error.message.includes('socket'))) {
                logger.warn(`检测到网络错误，可能由代理引起，正在更换代理并重试...`, 'PROXY');
                await accountManager.handleNetworkFailure(email, proxy);
                // 继续下一次循环
                continue;
            } else {
                // 如果不是可重试的网络错误，则直接跳出循环
                break;
            }
        }
    }

    logger.error(`经过 ${MAX_RETRIES} 次尝试后，请求最终失败。最后一次错误: ${lastError.message}`, 'REQUEST');
    return { status: false, response: null };
};

/**
 * 生成chat_id
 * @param {*} currentToken
 * @param {*} model
 * @returns {Promise<string|null>} 返回生成的chat_id，如果失败则返回null
 */
const generateChatID = async (initialToken, model, email, initialProxy) => {
    const MAX_RETRIES = 3;
    let lastError = null;
    let currentToken = initialToken;
    let currentProxy = initialProxy;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        const requestConfig = {
            headers: {
                'Authorization': `Bearer ${currentToken}`,
                'Content-Type': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0',
                "Connection": "keep-alive",
                "Accept": "*/*",
                "Accept-Encoding": "gzip, deflate, br"
            },
            timeout: 60 * 1000,
        };

        if (currentProxy) {
            try {
                const agent = new SocksProxyAgent(currentProxy);
                requestConfig.httpAgent = agent;
                requestConfig.httpsAgent = agent;
            } catch (agentError) {
                logger.error(`为generateChatID创建代理Agent失败 (${currentProxy}): ${agentError.message}`, 'PROXY');
            }
        }

        try {
            const response_data = await axios.post("https://chat.qwen.ai/api/v2/chats/new", {
                "title": "New Chat",
                "models": [model],
                "chat_mode": "local",
                "chat_type": "t2i",
                "timestamp": new Date().getTime()
            }, requestConfig);

            if (response_data.data?.data?.id) {
                return response_data.data.data.id;
            }
            lastError = new Error('Invalid response data when generating chat_id');

        } catch (error) {
            lastError = error;
            let proxyHostForLog = currentProxy || 'none';
            if (currentProxy) {
                try {
                    const proxyUrl = new URL(currentProxy);
                    proxyHostForLog = proxyUrl.hostname;
                } catch (e) { /* ignore */ }
            }
            logger.error(`生成chat_id失败 (账户: ${email} (${proxyHostForLog}), 尝试: ${attempt}/${MAX_RETRIES}): ${error.message}`, 'CHAT');

            const networkErrorCodes = ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'ENETUNREACH', 'EAI_AGAIN'];
            if (currentProxy && (networkErrorCodes.includes(error.code) || error.message.includes('timeout') || error.message.includes('ECONN') || error.message.includes('socket'))) {
                logger.warn(`检测到网络错误，可能由代理引起，正在更换代理并重试...`, 'PROXY');
                await accountManager.handleNetworkFailure(email, currentProxy);
                // 更新代理以供下一次循环使用
                currentProxy = accountManager.getProxyForAccount(email);
                continue;
            } else {
                break;
            }
        }
    }

    logger.error(`经过 ${MAX_RETRIES} 次尝试后，生成chat_id最终失败。最后一次错误: ${lastError.message}`, 'CHAT');
    return null;
}

module.exports = {
    sendChatRequest,
    generateChatID
}