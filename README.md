# 造物岛（Maker Island）

一个面向小学三年级孩子的浏览器 3D 建模闯关原型。孩子从世界地图进入任务，在游戏故事中一次学习一个操作，通过动手建造、即时检查和自由改造逐步掌握空间拆解与设计思维。

## 当前版本

首版完成了“形状港”的纵向体验：

- 12 关学习地图，其中第 1～4 关可以实际游玩，第 5～12 关作为后续路线预览。
- 方块、球体、圆柱和圆锥等基础形状。
- 移动、缩放、旋转、复制、落到地面、设为空洞和组合等基础操作。
- 按知识点自动检查任务，不评价作品是否“漂亮”。
- 关卡星星、作品自动保存和家长查看入口。
- 无账号本机模式，不要求孩子填写真实个人信息。

首版暂不包含第 5～12 关的完整任务、多人互动、排行榜、云端账号、跨设备同步、D1 数据库、R2 文件存储或 3D 打印导出。

## 运行要求

- Node.js 24.15 LTS（推荐）；测试工具也支持 22.22.2 LTS 或 26 及以上版本
- npm
- 推荐使用近期版本的 Chrome、Edge 或 Safari，以及带滚轮的鼠标

正式建模建议使用电脑或横屏平板；手机更适合查看地图，不适合精确拖动。

## 本地运行

首次拉取项目后安装锁定版本的依赖：

```bash
npm ci
```

启动本地开发环境：

```bash
npm run dev
```

终端会显示访问地址。开发环境同时运行前端页面和本地 Cloudflare Workers 运行时，`/api/health` 可用于检查 Worker 是否正常响应。

## 检查与构建

运行自动测试：

```bash
npm test
```

执行前端类型检查并生成 Cloudflare 部署产物：

```bash
npm run build
```

使用接近线上 Cloudflare Workers 的本地运行时预览构建结果：

```bash
npm run preview
```

`preview` 会先重新构建项目。Cloudflare Vite 插件会在 `dist/` 中生成浏览器资源、Worker 包和部署所需的输出配置；不要在输入用的 `wrangler.jsonc` 中手工填写 `assets.directory`。

发版前可以只检查部署包、不上传到 Cloudflare：

```bash
npx wrangler deploy --dry-run
```

请先至少执行过一次 `npm run build`，确保 Wrangler 能读取插件生成的输出配置。

## 部署到 Cloudflare

本项目使用 Cloudflare Workers Static Assets，不使用旧式 Pages Functions。第一次部署前，在本机登录自己的 Cloudflare 账号：

```bash
npx wrangler login
npx wrangler whoami
```

确认账号正确后再部署：

```bash
npm run deploy
```

该命令会先运行完整构建，再由 Wrangler 使用 Cloudflare Vite 插件生成的输出配置上传前端资源和 Worker。它会真实创建或更新名为 `maker-island` 的 Worker；如果账号里已有同名项目，请先修改 `wrangler.jsonc` 的 `name`。

当前 Worker 只提供 `GET /api/health` 和对应的 `HEAD` 检查（其他 `/api/*` 返回 JSON 404）。静态资源和前端路由由 Cloudflare 直接处理，只有 `/api/*` 会优先进入 Worker，从而避免普通页面访问产生不必要的 Worker 调用。

## 数据与隐私边界

当前版本采用隐私优先的本机学习模式：

- 不提供孩子账号，也不要求姓名、学校、生日、照片或联系方式。
- 关卡进度和模型数据只保存在当前浏览器的 `localStorage` 中，键名为 `maker-island-progress-v1`。
- 当前代码不会把作品、操作记录或学习进度上传到 Worker，也没有接入第三方广告、行为分析、社交分享或聊天功能。
- `/api/health` 只返回服务状态和版本，不接收或保存学习数据。
- 清理浏览器数据、使用无痕模式或更换设备会丢失本地进度；首版没有云端备份或跨设备恢复能力。
- 与所有公开网站一样，Cloudflare 在提供网络服务时仍可能处理正常请求所需的技术信息，例如 IP 地址和浏览器请求头；“本机保存”不等于访问网站时完全没有网络元数据。
- 任何能使用同一浏览器配置的人都可能看到本机进度，因此它不是家长控制或加密保险箱。

面向儿童公开发布前，仍需要根据实际发布地区、运营主体和未来收集的数据准备正式隐私说明并完成合规审查。不要把密钥写进前端代码或 `VITE_*` 环境变量；以后增加家庭账号、D1、R2 或反馈表单时，应重新设计家长同意、数据删除、最小化收集和访问权限。

## Cloudflare 配置说明

- `vite.config.ts`：同时启用 React 与官方 Cloudflare Vite 插件。
- `wrangler.jsonc`：启用 SPA 回退，并使用 `run_worker_first: ["/api/*"]` 明确分离 API 与静态资源路由。
- `worker/index.ts`：只负责极小的健康检查 API，不保存用户数据。
- `src/progress.ts`：负责浏览器本地进度读写。

项目目前没有 D1、R2、KV 或环境密钥绑定；这些能力应在确有跨设备同步需求后再加入。
