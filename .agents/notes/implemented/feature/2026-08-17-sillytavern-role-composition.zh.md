# SillyTavern Role 组装兼容

日期：2026-08-17。状态：已在本地实现。

## 问题

Izumi 真实 Preset 在 SillyTavern 能开始角色扮演，但早期 Harness 适配只保留定义、顺序与 Marker，把 53 个 System、2 个 Assistant、1 个 User 启用项都注册为 DSH System Prompt Section。`role="assistant"` 只是文本属性，不是 ST Assistant Message。与此同时 `chatHistory` Marker 留给原生 Session，后历史 Prompt 中的 `{{lastUserMessage}}` 被替换为占位说明，真正用户消息直到整个 System Prompt 之后才由 DSH 发送。结果是 ST 的 `System → Assistant 接 → User 指南 → System 角色/历史/后置规则 → Assistant Prefill → Generate` 变成 `单个 System 字符串 → 当前 User → Generate`。

该差异让 Preset 主提示中的内部作者人格“泉此方/小此/Master”成为最明确的 Assistant 身份，而 Character Card 只是一段后续角色资料。真实状态扫描证明卡提希娅 Marker 位于启用顺序 105–109，但 `💾主提示` 在 40 明确写“你是泉此方”，`接` 和 `卡思维链(K)` 的 Assistant 边界也已丢失。新 Session 还没有自动加入 Character Card `first_mes`，进一步缺少 ST 的角色历史锚点。

## 决策

不删除或重写源 Preset。Agent 在 `agent/inbox/claimed` 领取当前用户输入时先缓存其正文，使第一次 System Prompt 组装即可把真实正文展开到 `{{lastUserMessage}}`；后续工具 Step 回退到 Session 中最新的原生 User Message。`renderPromptLayer` 将 User/Assistant 定义分别序列化为 `<st-user-message>` 与 `<st-assistant-prefill>`，而 System/Marker 保持现有资源标签。固定 `st-role-protocol` 使用顺序 990，声明 ST 消息语义、作者人格属于内部创作过程，以及当前可见 Assistant 必须属于 Binding 的 Primary Character；全部 256 个导入 Prompt Seat 从顺序 1000 开始。若所选顺序的最后一层是 Assistant Prefill，该层固定投影到 Seat 255（顺序 1255），DSH Runtime Mode 使用顺序 1254 紧邻其前；因此工具要求位于生成前尾部，而 Preset 自己的 Assistant Prefill 仍是模型读取的最后一组 System 内容。带未闭合 planning/thinking/reasoning 标记的 Prefill 不以可继续的裸标签进入 System Carrier；兼容序列化保留转义后的完整源文本，并以 `visibility="private-reasoning"` 要求 Provider 在 Reasoning Channel 中应用且不得泄漏规划块。

Client 在首次绑定空白 Session 且 Transcript 为空时自动执行 `rp-studio-opening`，把 `first_mes` 以 `plugin/recall` 角色历史加入原生 Session；后续应用不会重复插入。DSH 公开扩展点仍只提供 System Prompt Carrier，因此这是一套显式兼容序列化，不声称创建了真正的中间 Assistant/User Message。

## 验证

真实 Izumi 文件确认 210 个定义、177 个顺序项、56 个启用项，启用 Role 为 53 System、2 Assistant、1 User，且 `squash_system_messages=true`。单元测试确认 Assistant/User 分别渲染为新的语义标签，已领取但尚未写入 Session 的“你是？”在第一步进入 `lastUserMessage`，256 个 Seat 使用 1000 起始顺序，尾部 Assistant Prefill 位于顺序 1255 且 Runtime Mode 位于 1254；规划 Prefill 的源标记被转义并带私有 Reasoning 意图。实际 Tarball 安装到一次性 DSH Home 后，Codex 内置浏览器使用同一 Izumi Harness 与卡提希娅运行新 Session；`first_mes` 自动进入角色历史，第一步 Reasoning 明确识别 Master 输入“你是？”，先提交卡提希娅所在世界状态，随后由卡提希娅自我介绍，RP 对话页也把正文署名为卡提希娅，没有再把泉此方、小此或 Master 作为可见角色身份，`konatan_planning` 也没有进入可见正文。该 Preset 启用的“扩写输入”会继续把短句扩展为剧情，这是源 Preset 的预期行为，不由兼容层删除。
