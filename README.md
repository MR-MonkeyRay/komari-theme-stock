# Atlas Stock · Komari 主题

股票行情软件风格的 [Komari](https://github.com/komari-monitor/komari) 监控主题：首页是报价表式的节点列表，详情页用 K 线展示 CPU、内存和磁盘趋势。

## 开发

需要 Node.js 22 或更高版本。

```bash
npm install
# 开发服务器会把 /api 和 /themes 代理到 Komari 后端
VITE_API_TARGET=http://127.0.0.1:25774 npm run dev
```

也可以在 `.env.local` 中写入 `VITE_API_TARGET=...`。

## 构建与打包

```bash
npm run package
```

产物位于 `release/<short>-<version>.zip`，压缩包根目录包含：

- `komari-theme.json`：主题元数据
- `preview.png`：预览图
- `dist/`：构建产物（`dist/index.html` 为页面模板）

在 Komari 后台「主题管理」上传该压缩包即可安装。

## 主题约定

- `index.html` 中的 `<title>Komari Monitor</title>` 与 `<meta name="description" content="A simple server monitor tool." />` 需保持原样，Komari 会将其替换为站点名称与描述。
- 页脚保留 `Powered by Komari Monitor.`。
- 不占用 `/admin` 与 `/terminal` 路径。

参考：[Komari 主题开发文档](https://komari-document.pages.dev/dev/theme)

## 许可

MIT
