const crypto = require('crypto')
const { jwtDecode } = require('jwt-decode')
const { logger } = require('./logger')


const isJson = (str) => {
  try {
    JSON.parse(str)
    return true
  } catch (error) {
    return false
  }
}

const sleep = async (ms) => {
  return await new Promise(resolve => setTimeout(resolve, ms))
}

const sha256Encrypt = (text) => {
  if (typeof text !== 'string') {
    logger.error('输入必须是字符串类型', 'TOOLS')
    throw new Error('输入必须是字符串类型')
  }
  const hash = crypto.createHash('sha256')
  hash.update(text, 'utf-8')
  return hash.digest('hex')
}

const JwtDecode = (token) => {
  try {
    const decoded = jwtDecode(token, { complete: true })
    return decoded
  } catch (error) {
    logger.error('解析JWT失败', 'JWT', '', error)
    return null
  }
}

/**
 * 生成UUID v4
 * 使用Node.js内置的crypto.randomUUID()
 * @returns {string} UUID v4字符串
 */
const generateUUID = () => {
  return crypto.randomUUID()
}

const getProxyHost = (proxyUrl) => {
  if (!proxyUrl) {
    return 'N/A';
  }
  try {
    const url = new URL(proxyUrl);
    return url.hostname;
  } catch (e) {
    return proxyUrl;
  }
};

module.exports = {
  isJson,
  sleep,
  sha256Encrypt,
  JwtDecode,
  generateUUID,
  getProxyHost
}
