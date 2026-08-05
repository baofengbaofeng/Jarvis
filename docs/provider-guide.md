# 第三方自定义 Provider 接入引导

本文说明如何通过配置导入（C12）接入一个第三方自定义 Provider。整个流程不包含任何模型名示例——模型应在导入后在「Provider」页面手动添加，避免把特定模型写死在模板里。

## 前置概念

- **API Key 永不落盘明文**：Provider 的密钥保存在系统 Keychain 中，配置文件中只携带 `apiKeyRef`（Keychain 引用）。导出的配置文件里不会出现明文密钥。
- **schemaVersion**：配置文件顶部的 `schemaVersion` 必须 ≤ 当前应用支持的版本，否则导入会被拒绝。官方模板的版本即当前版本。

## 接入步骤

1. **复制模板**

   复制 `resources/provider-templates/openai-compatible.json`，另存为你自己的配置文件（例如 `my-provider.json`）。

2. **填写 base_url**

   将 `providers[0].baseUrl` 改为第三方服务的 API 地址。例如你的服务遵守 OpenAI 兼容的 `/chat/completions` 约定，则填入其基础地址（通常以 `/v1` 结尾，具体以服务方文档为准）。

   （可选）修改 `providers[0].id` 和 `providers[0].name`，避免与已有 Provider 冲突；`id` 在同一配置中是唯一键。

3. **通过配置导入导入该文件**

   打开「设置 → 配置导入 / 导出」，选择「导入配置」，选中你刚才填写的文件。导入策略可选：

   - **跳过已存在**：`id` 已存在时保留原样，不写入。
   - **覆盖已存在**：`id` 已存在时用导入内容整体替换。
   - **合并已存在**：`id` 已存在时仅用导入中非空的字段覆盖，其余字段保留（例如模板里空的 `apiKeyRef` 不会清掉已有引用）。

4. **在 Provider 页补充 API Key**

   导入只注册了 Provider 的地址信息，密钥需要你手动填写：

   - 打开「设置 → Provider」。
   - 找到刚导入的 Provider，点击编辑并填入该服务的 API Key。
   - Key 会被写入系统 Keychain，配置里仍只有引用。

5. **添加模型**

   在 Provider 的编辑页中添加该服务实际支持的模型（模型 ID 以服务方文档为准）。建议不要在任何配置模板中硬编码模型名。

## 注意事项

- 导出的配置同样只含 `apiKeyRef`，分享配置文件不会泄露 Key。
- 若配置文件中的 `schemaVersion` 高于当前应用版本，请先升级应用，或把版本号降到当前支持值。
- 导入代理（Agent）时，若其 `modelId` 引用了当前数据库里不存在的模型，该 Agent 会被跳过而不是中断整个导入。
