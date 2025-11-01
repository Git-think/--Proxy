<div align="center">

本项目修改自：https://github.com/Rfym21/Qwen2API

# 🚀 Qwen-Proxy

[![Version](https://img.shields.io/badge/version-2025.11.01.00.00-blue.svg)](https://github.com/Git-think/Qwen2Api-Proxy)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![Docker](https://img.shields.io/badge/Docker-supported-blue.svg)](https://hub.docker.com/r/Git-think/qwen2api-proxy)
[![Binary](https://img.shields.io/badge/Binary-Available-orange.svg)](https://github.com/Git-think/Qwen2Api-Proxy/releases)

[📖 文档](#api-文档) | [🐳 Docker 部署](#docker-部署)

</div>

## 🛠️ 快速开始

### 环境要求

- Node.js 18+ (源码部署时需要)
- Docker (可选)
- Redis (可选，用于数据持久化)

### ⚙️ 环境配置

创建 `.env` 文件并配置以下参数：

```bash
# 🌐 服务配置
LISTEN_ADDRESS=localhost       # 监听地址
SERVICE_PORT=3000             # 服务端口

# 🔐 安全配置
API_KEY=sk-123456,sk-456789   # API 密钥 (必填，支持多密钥)
ACCOUNTS=                     # 账户配置 (格式: user1:pass1,user2:pass2)

# 🚀 PM2 多进程配置
PM2_INSTANCES=1               # PM2进程数量 (1/数字/max)
PM2_MAX_MEMORY=1G             # PM2内存限制 (100M/1G/2G等)
                              # 注意: PM2集群模式下所有进程共用同一个端口

# 🔍 功能配置
SEARCH_INFO_MODE=table        # 搜索信息展示模式 (table/text)
OUTPUT_THINK=true             # 是否输出思考过程 (true/false)
SIMPLE_MODEL_MAP=false        # 简化模型映射 (true/false)

# 🗄️ 数据存储
DATA_SAVE_MODE=none           # 数据保存模式 (none/file/redis)
REDIS_URL=                    # Redis 连接地址 (可选)

# 📸 缓存配置
CACHE_MODE=default            # 图片缓存模式 (default/file)

# 🌐 代理配置
SOCKS5_PROXIES=               # SOCKS5 代理列表 (格式: socks5://user:pass@host:port,socks5://user:pass@host:port)
```

#### 📋 配置说明

| 参数 | 说明 | 示例 |
|------|------|------|
| `LISTEN_ADDRESS` | 服务监听地址 | `localhost` 或 `0.0.0.0` |
| `SERVICE_PORT` | 服务运行端口 | `3000` |
| `API_KEY` | API 访问密钥，支持多密钥配置。第一个为管理员密钥（可访问前端管理页面），其他为普通密钥（仅可调用API）。多个密钥用逗号分隔 | `sk-admin123,sk-user456,sk-user789` |
| `PM2_INSTANCES` | PM2进程数量 | `1`/`4`/`max` |
| `PM2_MAX_MEMORY` | PM2内存限制 | `100M`/`1G`/`2G` |
| `SEARCH_INFO_MODE` | 搜索结果展示格式 | `table` 或 `text` |
| `OUTPUT_THINK` | 是否显示 AI 思考过程 | `true` 或 `false` |
| `SIMPLE_MODEL_MAP` | 简化模型映射，只返回基础模型不包含变体 | `true` 或 `false` |
| `DATA_SAVE_MODE` | 数据持久化方式。`file` 模式下，如果 `data/data.json` 不存在，应用启动时会自动从 `.env` 的 `ACCOUNTS` 变量中读取账户信息，并为它们获取有效的令牌后存入 `data.json`。 | `none`/`file`/`redis` |
| `REDIS_URL` | Redis 数据库连接 | `redis://localhost:6379` |
| `CACHE_MODE` | 图片缓存存储方式 | `default`/`file` |
| `LOG_LEVEL` | 日志级别 | `DEBUG`/`INFO`/`WARN`/`ERROR` |
| `ENABLE_FILE_LOG` | 是否启用文件日志 | `true` 或 `false` |
| `LOG_DIR` | 日志文件目录 | `./logs` |
| `MAX_LOG_FILE_SIZE` | 最大日志文件大小(MB) | `10` |
| `MAX_LOG_FILES` | 保留的日志文件数量 | `5` |
| `SOCKS5_PROXIES` | SOCKS5 代理列表，多个代理地址用逗号分隔 | `socks5://user1:pass1@host1:port1,socks5://user2:pass2@host2:port2` |

#### 🔑 多API_KEY配置说明

`API_KEY` 环境变量支持配置多个API密钥，用于实现不同权限级别的访问控制：

**配置格式:**
```bash
# 单个密钥（管理员权限）
API_KEY=sk-admin123

# 多个密钥（第一个为管理员，其他为普通用户）
API_KEY=sk-admin123,sk-user456,sk-user789
```

**权限说明:**

| 密钥类型 | 权限范围 | 功能描述 |
|----------|----------|----------|
| **管理员密钥** | 完整权限 | • 访问前端管理页面<br>• 修改系统设置<br>• 调用所有API接口<br>• 添加/删除普通密钥 |
| **普通密钥** | API调用权限 | • 仅可调用API接口<br>• 无法访问前端管理页面<br>• 无法修改系统设置 |

**使用场景:**
- **团队协作**: 为不同团队成员分配不同权限的API密钥
- **应用集成**: 为第三方应用提供受限的API访问权限
- **安全隔离**: 将管理权限与普通使用权限分离

**注意事项:**
- 第一个API_KEY自动成为管理员密钥，拥有最高权限
- 管理员可以通过前端页面动态添加或删除普通密钥
- 所有密钥都可以正常调用API接口，权限差异仅体现在管理功能上

#### 📸 CACHE_MODE 缓存模式说明

`CACHE_MODE` 环境变量控制图片缓存的存储方式，用于优化图片上传和处理性能：

| 模式 | 说明 | 适用场景 |
|------|------|----------|
| `default` | 内存缓存模式 (默认) | 单进程部署，重启后缓存丢失 |
| `file` | 文件缓存模式 | 多进程部署，缓存持久化到 `./caches/` 目录 |

**推荐配置:**
- **单进程部署**: 使用 `CACHE_MODE=default`，性能最佳
- **多进程/集群部署**: 使用 `CACHE_MODE=file`，确保进程间缓存共享
- **Docker 部署**: 建议使用 `CACHE_MODE=file` 并挂载 `./caches` 目录

**文件缓存目录结构:**
```
caches/
├── [signature1].txt    # 缓存文件，包含图片URL
├── [signature2].txt
└── ...
```

#### 🌐 SOCKS5 代理配置说明

`SOCKS5_PROXIES` 环境变量用于配置 SOCKS5 代理列表，以增强网络请求的稳定性和访问能力：

**配置格式:**
```bash
# 单个代理
SOCKS5_PROXIES=socks5://user:pass@host:port

# 多个代理（用逗号分隔）
SOCKS5_PROXIES=socks5://user1:pass1@host1:port1,socks5://user2:pass2@host2:port2
```

**功能说明:**
- **按需测试**: 代理不再于启动时全部测试，而是在需要时（如首次分配、验证绑定）才进行测试，大幅提升启动速度。
- **智能分配**: 采用更智能的分配策略，优先为账户分配完全空闲的代理，其次是未测试的代理，最后才在已使用的代理中选择负载最低的进行共享。
- **启动时验证和重平衡**: 应用启动时会自动验证已持久化的账户-代理绑定关系。如果绑定的代理失效，或多个账户绑定了同一个代理且存在空闲代理，系统会自动为受影响的账户重新分配新的代理。
- **持久化绑定**: 代理与账号的绑定关系可保存在内存、本地文件或 Redis 中，确保账号使用固定的代理。
- **故障转移**: 请求失败时，系统会自动验证当前代理的可用性。若代理失效，则为该账号重新分配一个新代理，并更新绑定关系。
- **日志优化**: 日志中会显示 `email (ProxyIP)` 格式，方便追踪。
- **无代理回退**: 如果没有配置或没有可用的代理，系统会记录信息并直接连接，不会崩溃。

**注意事项:**
- 代理地址格式必须为 `socks5://user:pass@host:port`
- 多个代理地址之间使用逗号 `,` 分隔，无需引号
- 代理配置与 `DATA_SAVE_MODE` 配合使用，以实现持久化绑定

> 💡 **提示**: 可以在 [Upstash](https://upstash.com/) 免费创建 Redis 实例，使用 TLS 协议时地址格式为 `rediss://...`

<div>
<img src="./docs/images/upstash.png" alt="Upstash Redis" width="600">
</div>

---

## 🚀 部署方式

### 🐳 Docker 部署

#### 方式一：直接运行

```bash
docker run -d \
  -p 3000:3000 \
  -e API_KEY=sk-admin123,sk-user456,sk-user789 \
  -e DATA_SAVE_MODE=none \
  -e CACHE_MODE=file \
  -e ACCOUNTS= \
  -e SOCKS5_PROXIES=socks5://user:pass@host:port \
  -v ./caches:/app/caches \
  --name qwen2api-proxy \
  git0think/qwen2api-proxy:latest
```

#### 方式二：Docker Compose

```bash
# 下载配置文件
curl -o docker-compose.yml https://raw.githubusercontent.com/Git-think/Qwen2Api-Proxy/refs/heads/main/docker-compose.yml

# 启动服务
docker compose pull && docker compose up -d
```

### 📦 本地部署

```bash
# 克隆项目
git clone https://github.com/Git-think/Qwen2Api-Proxy.git
cd Qwen2Api-Proxy

# 安装依赖
npm install

# 配置环境变量
cp .env.example .env
# 编辑 .env 文件

# 构建网页端
cd .\public\ && npm install && npm run build && cd ../

# 智能启动 (推荐 - 自动判断单进程/多进程)
npm start

# 开发模式
npm run dev
```

### 🚀 PM2 多进程部署

使用 PM2 进行生产环境多进程部署，提供更好的性能和稳定性。

**重要说明**: PM2 集群模式下，所有进程共用同一个端口，PM2 会自动进行负载均衡。

### 🤖 智能启动模式

使用 `npm start` 可以自动判断启动方式：

- 当 `PM2_INSTANCES=1` 时，使用单进程模式
- 当 `PM2_INSTANCES>1` 时，使用 Node.js 集群模式
- 自动限制进程数不超过 CPU 核心数

### ☁️ Hugging Face 部署

快速部署到 Hugging Face Spaces：

[![Deploy to Hugging Face](https://img.shields.io/badge/🤗%20Hugging%20Face-Deploy-yellow)](https://huggingface.co/spaces/devme/q2waepnilm)

<div>
<img src="./docs/images/hf.png" alt="Hugging Face Deployment" width="600">
</div>

---

## 📁 项目结构

```
Qwen2Api-Proxy/
├── Dockerfile
├── README.md
├── docker-compose.yml
├── docker-compose-redis.yml
├── ecosystem.config.js              # PM2配置文件
├── package.json
│
├── caches/                          # 缓存文件目录
├── data/                            # 数据文件目录
│   ├── data.json
│   └── data_template.json
│
├── src/                             # 后端源代码目录
│   ├── server.js                    # 主服务器文件
│   ├── start.js                     # 智能启动脚本 (自动判断单进程/多进程)
│   ├── config/
│   │   └── index.js                 # 配置文件
│   ├── controllers/                 # 控制器目录
│   │   ├── chat.js
│   │   ├── cli.chat.js              # CLI聊天控制器
│   │   └── models.js
│   ├── middlewares/                 # 中间件目录
│   │   ├── authorization.js
│   │   └── chat-middleware.js
│   ├── models/                      # 模型目录
│   │   └── models-map.js
│   ├── routes/                      # 路由目录
│   │   ├── accounts.js
│   │   ├── chat.js
│   │   ├── cli.chat.js              # CLI聊天路由
│   │   ├── models.js
│   │   ├── settings.js
│   │   └── verify.js
│   └── utils/                       # 工具函数目录
│       ├── account-rotator.js
│       ├── account.js
│       ├── chat-helpers.js
│       ├── cli.manager.js           # CLI管理器
│       ├── data-persistence.js
│       ├── img-caches.js
│       ├── logger.js                # 日志工具
│       ├── model-utils.js
│       ├── precise-tokenizer.js     # 精确分词器
│       ├── proxy-manager.js         # 代理管理器
│       ├── redis.js
│       ├── request.js
│       ├── setting.js
│       ├── token-manager.js
│       ├── tools.js
│       └── upload.js
│
└── public/                          # 前端项目目录
    ├── dist/                        # 编译后的前端文件
    │   ├── assets/                  # 静态资源
    │   ├── favicon.png
    │   └── index.html
    ├── src/                         # 前端源代码
    │   ├── App.vue                  # 主应用组件
    │   ├── main.js                  # 入口文件
    │   ├── style.css                # 全局样式
    │   ├── assets/                  # 静态资源
    │   │   └── background.mp4
    │   ├── routes/                  # 路由配置
    │   │   └── index.js
    │   └── views/                   # 页面组件
    │       ├── auth.vue             # 认证页面
    │       ├── dashboard.vue        # 仪表板页面
    │       └── settings.vue         # 设置页面
    ├── package.json                 # 前端依赖配置
    ├── package-lock.json
    ├── index.html                   # 前端入口HTML
    ├── postcss.config.js            # PostCSS配置
    ├── tailwind.config.js           # TailwindCSS配置
    ├── vite.config.js               # Vite构建配置
    └── public/                      # 公共静态资源
        └── favicon.png
```

## 📖 API 文档

### 🔐 API 认证说明

本API支持多密钥认证机制，所有API请求都需要在请求头中包含有效的API密钥：

```http
Authorization: Bearer sk-your-api-key
```

**支持的密钥类型:**
- **管理员密钥**: 第一个配置的API_KEY，拥有完整权限
- **普通密钥**: 其他配置的API_KEY，仅可调用API接口

**认证示例:**
```bash
# 使用管理员密钥
curl -H "Authorization: Bearer sk-admin123" http://localhost:3000/v1/models

# 使用普通密钥
curl -H "Authorization: Bearer sk-user456" http://localhost:3000/v1/chat/completions
```

### 🔍 获取模型列表

获取所有可用的 AI 模型列表。

```http
GET /v1/models
Authorization: Bearer sk-your-api-key
```

```http
GET /models (免认证)
```

**响应示例:**
```json
{
  "object": "list",
  "data": [
    {
      "id": "qwen-max-latest",
      "object": "model",
      "created": 1677610602,
      "owned_by": "qwen"
    }
  ]
}
```

### 💬 聊天对话

发送聊天消息并获取 AI 回复。

```http
POST /v1/chat/completions
Content-Type: application/json
Authorization: Bearer sk-your-api-key
```

**请求体:**
```json
{
  "model": "qwen-max-latest",
  "messages": [
    {
      "role": "system",
      "content": "你是一个有用的助手。"
    },
    {
      "role": "user",
      "content": "你好，请介绍一下自己。"
    }
  ],
  "stream": false,
  "temperature": 0.7,
  "max_tokens": 2000
}
```

**响应示例:**
```json
{
  "id": "chatcmpl-123",
  "object": "chat.completion",
  "created": 1677652288,
  "model": "qwen-max-latest",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "你好！我是一个AI助手..."
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 20,
    "completion_tokens": 50,
    "total_tokens": 70
  }
}
```

### 🎨 图像生成/编辑

使用 `-image` 模型启用文本到图像生成功能。
使用 `-image-edit` 模型启用图像修改功能。
当使用``-image` 时你可以通过在请求体中添加 `size` 参数或在消息内容中包含特定关键词 `1:1`, `4:3`, `3:4`, `16:9`, `9:16` 来控制图片尺寸。

```http
POST /v1/chat/completions
Content-Type: application/json
Authorization: Bearer sk-your-api-key
```

**请求体:**
```json
{
  "model": "qwen-max-latest-image",
  "messages": [
    {
      "role": "user",
      "content": "画一只在花园里玩耍的小猫咪，卡通风格"
    }
  ],
  "size": "1:1",
  "stream": false
}
```

**支持的参数:**
- `size`: 图片尺寸，支持 `"1:1"`、`"4:3"`、`"3:4"`、`"16:9"`、`"9:16"`
- `stream`: 支持流式和非流式响应

**响应示例:**
```json
{
  "created": 1677652288,
  "model": "qwen-max-latest",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "![image](https://example.com/generated-image.jpg)"
      },
      "finish_reason": "stop"
    }
  ]
}
```

### 🎯 高级功能

#### 🔍 智能搜索模式

在模型名称后添加 `-search` 后缀启用搜索功能：

```json
{
  "model": "qwen-max-latest-search",
  "messages": [...]
}
```

#### 🧠 推理模式

在模型名称后添加 `-thinking` 后缀启用思考过程输出：

```json
{
  "model": "qwen-max-latest-thinking",
  "messages": [...]
}
```

#### 🔍🧠 组合模式

同时启用搜索和推理功能：

```json
{
  "model": "qwen-max-latest-thinking-search",
  "messages": [...]
}
```

#### 🎨 T2I 生图模式

通过设置 `chat_type` 参数为 `t2i` 启用文本到图像生成功能：

```json
{
  "model": "qwen-max-latest",
  "chat_type": "t2i",
  "messages": [
    {
      "role": "user",
      "content": "画一只可爱的小猫咪"
    }
  ],
  "size": "1:1"
}
```

**支持的图片尺寸:** `1:1`、`4:3`、`3:4`、`16:9`、`9:16`

**智能尺寸识别:** 系统会自动从提示词中识别尺寸关键词并设置对应尺寸

#### 🖼️ 多模态支持

API 自动处理图像上传，支持在对话中发送图片：

```json
{
  "model": "qwen-max-latest",
  "messages": [
    {
      "role": "user",
      "content": [
        {
          "type": "text",
          "text": "这张图片里有什么？"
        },
        {
          "type": "image_url",
          "image_url": {
            "url": "data:image/jpeg;base64,..."
          }
        }
      ]
    }
  ]
}
```

### 🖥️ CLI 端点

使用CLI端点仅支持 qwen3-coder-plus 和 qwen3-coder-flash，支持256K上下文和工具调用（Function Calling）

#### 💬 CLI 聊天对话

通过 CLI 端点发送聊天请求，支持流式和非流式响应。

```http
POST /cli/v1/chat/completions
Content-Type: application/json
Authorization: Bearer API_KEY
```

**请求体:**
```json
{
  "model": "qwen3-coder-plus",
  "messages": [
    {
      "role": "user",
      "content": "你好，请介绍一下自己。"
    }
  ],
  "stream": false,
  "temperature": 0.7,
  "max_tokens": 2000
}
```

**流式请求:**
```json
{
  "model": "qwen3-coder-flash",
  "messages": [
    {
      "role": "user",
      "content": "写一首关于春天的诗。"
    }
  ],
  "stream": true
}
```

**响应格式:**

非流式响应与标准 OpenAI API 格式相同：
```json
{
  "id": "chatcmpl-123",
  "object": "chat.completion",
  "created": 1677652288,
  "model": "qwen3-coder-plus",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "你好！我是一个AI助手..."
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 20,
    "completion_tokens": 50,
    "total_tokens": 70
  }
}
```

流式响应使用 Server-Sent Events (SSE) 格式：
```
data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1677652288,"model":"qwen3-coder-flash","choices":[{"index":0,"delta":{"content":"你好"},"finish_reason":null}]}

data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1677652288,"model":"qwen3-coder-flash","choices":[{"index":0,"delta":{"content":"！"},"finish_reason":null}]}

data: [DONE]
```
