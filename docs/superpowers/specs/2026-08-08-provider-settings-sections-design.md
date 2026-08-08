# Provider settings: add / list sections + Token copy

## Goal

Clarify the Provider settings page into an add section and a list section, and use **Token** as the English label for the secret field (zh-CN stays 秘钥).

## Layout

1. **Page header**
   - Title: `供应商添加` / `Add Provider` (`settings.provider.title`)
   - Subtitle: existing description (en wording uses Token where it referred to the secret)
2. **Add area** — always-on `ProviderForm` (no extra subsection title; header is the add title)
3. **Divider** — full-width hairline between add area and list
4. **List section**
   - Title: `供应商列表` / `Provider list` (`settings.provider.listTitle`)
   - Existing provider cards below; empty list shows title with no cards

## i18n

| Key | zh-CN | en |
|-----|-------|-----|
| `settings.provider.title` | 供应商添加 | Add Provider |
| `settings.provider.listTitle` | 供应商列表 | Provider list |
| `settings.provider.apiKey` | 秘钥 | Token |
| `settings.provider.apiKeyHint` | (unchanged meaning) | Paste the vendor access token (often starts with sk-). Stored only in local secure storage — never in config or exports. |
| `settings.provider.errors.apiKeyRequired` | 请填写秘钥 | Token is required |
| `settings.provider.errors.secureStorage` | …无法保存秘钥 | …cannot save the token |
| `settings.provider.description` / `baseUrlHint` | 秘钥 | Use Token instead of “secret key” / “secret” where referring to this field |

Nav `settings.nav.providers` stays `供应商` / `Providers`.

## Out of scope

Form validation rules, model sub-forms, sidebar nav label, searchProviders “API Key” placeholder.
