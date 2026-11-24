# Atlas Stock · Komari 主题

股票行情软件风格的 [Komari](https://github.com/komari-monitor/komari) 监控主题：首页是报价表式的节点列表，详情页用 K 线展示 CPU、内存和磁盘趋势。

![preview](preview.png)

## 特性

- **首页报价表**：大盘指数条（节点数、在线/高载/离线家数条、CPU 中位数及 15 分钟涨跌、内存占用、总上下行、本月/累计流量）；按大洲或后台分组的板块行；节点名下附「大洲·国家·UUID」代码；CPU、内存、磁盘三列均为「现值 + 较 1 小时均值涨跌（pp）+ 1 小时走势曲线」；表头点击排序（排序时平铺并带重排动画）；数值跳动时单元格红绿闪烁；离线节点置灰。
- **个股式详情**：顶部报价栏显示 CPU 现价、较区间开盘涨跌、区间最高/最低/均值/P95；CPU K 线叠加 MA5/MA20，下方为上行/下行镜像成交量副图，两者共用时间轴与十字光标；内存、磁盘 K 线；点阵地图、网络、续费、F10 系统信息与样本推断事件。
- **K 线口径**：高/低/收分别取服务端 `max`/`min`/`last` 聚合，开盘取上一根收盘；空心为区间上升、实心为区间下降，缺测区间留空。
- **配色**：深色「交易终端」与浅色「券商日间」两套，支持红涨绿跌 / 绿涨红跌；跟随 Komari 默认主题共用的 `appearance` 本地存储键。
- **键盘**：`↑↓` 选行、`Enter` 打开详情、`Esc` 关闭、`[` `]` 切换上/下一个节点、`/` 搜索、K 线获得焦点后 `←→` 逐根查看。
- 尊重系统「减少动态效果」设置。

## 主题设置

在 Komari 后台「主题管理 → Atlas 行情设置」中调整：

| 设置 | 说明 |
| --- | --- |
| 涨跌配色 | 红涨绿跌（默认）/ 绿涨红跌 |
| 节点分组 | 大洲（默认）/ 后台分组 / 不分组 |
| 显示 1 小时走势曲线 | 默认开启；关闭后三列改为占用条 |
| 实时刷新间隔（秒） | 1–60，默认 2 |
| 默认时间范围 | 24h（默认）/ 6h / 1h |
| 显示节点事件 | 默认开启 |

月流量需要 Komari 指标保留期覆盖当月（`traffic.up/down` 的保留天数），否则显示节点开机以来的累计流量。

## 开发

需要 Node.js 22 或更高版本。

```bash
npm install
# 开发服务器会把 /api 和 /themes 代理到 Komari 后端
VITE_API_TARGET=http://127.0.0.1:25774 npm run dev
```

也可以在 `.env.local` 中写入 `VITE_API_TARGET=...`。

没有可用后端时，可用离线模拟数据开发（12 个节点、24 小时历史）：

```bash
npm run dev:mock
```

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
