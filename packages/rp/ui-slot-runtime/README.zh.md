# @dsh-rp/ui-slot-runtime

[English](README.md) | 中文

`ctx.rpUiSlots` 是可安装包 UI 的 Host 侧注册中心。它有意与编译期 React Slot 注册中心分离：可信的第一方客户端插件仍可贡献原生 React 组件，而下载的 RP 包只能贡献版本化描述符和已通过完整性验证的静态资源。

每次注册都会复制资源字节、发布不可变元数据，并返回幂等释放器。包 Lifecycle Adapter 会在与 Component、Pipeline、Capability 相同的激活事务中注册 UI。发生冲突时会回滚完整激活；更新与卸载会先移除 Slot，再释放其归档所有权。

运行时接受固定位置 `studio.overview`、`studio.creator`、`studio.inspector`、`conversation.sidebar` 和 `message.after`。Runtime v1 对所有包信任等级都只允许声明式 HTML/CSS；`script: sandbox` 是保留值，但会失败关闭。L1 QuickJS/WASM 仍可用于模型能力，而不能成为浏览器 DOM 代码。信任等级永远不会授予同源访问：DSH Web 在不含 `allow-same-origin`、脚本、表单、弹窗、下载、顶层导航或 Host API 的 iframe 中嵌入包入口。HTML 校验会拒绝主动执行或导航元素、外部 URL、事件处理器与未声明资源。响应头把 CSS、图片、字体和媒体限制到精确的存活包/Slot 路径，并禁止连接、嵌套 frame、Worker、Object、表单、Referrer 与脚本。

入口和每个子资源都必须同时出现在 Slot 资产列表、包 Manifest 资产列表以及完整性绑定归档中。不安全路径、缺失文件、重复身份、声明不匹配和不支持的位置都会在发布前失败。资源查找按包与 Slot 隔离，返回脱离内部存储的字节，并在释放后立即停止解析。

## 模型体验

无直接影响，因为包 UI 只在模型请求之外观察 Host 投影的元数据，不获得模型、Tool、Session、文件系统、Secret 或网络权限。

#### KV Cache 影响

无。UI 资源不会进入模型上下文。

## 已知限制与延期工作

- DSH Web 会挂载全部五个位置。`conversation.sidebar` 进入会话作用域的可追加 Sidebar seat，`message.after` 则跟随 user 与 Assistant 消息行；二者和 Studio 复用同一份 apply 作用域 catalog 快照，并在对应包注册被 dispose 后消失。
- v1 Frame 有意保持声明式与单向：不提供浏览器脚本、`postMessage` Host Bridge 或动态高度协议。需要 Host 数据的交互必须通过未来的版本化、权限校验声明式事件 Bridge。
