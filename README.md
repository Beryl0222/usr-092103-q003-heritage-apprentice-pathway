# 老字号技艺传习履历后端

大师工作室记的是**手上功夫**，技能学校记的是**课时与成绩**，门店关心的是**能否独立上岗**，学员担心**试岗作品与师承署名散落後无法证明成长**。本服务把报名资格、师徒关系、课程版本、现场练习、作品批次、师傅评语、安全考核、岗位试用与就业去向，连成一条**只追加、可核验、按角色最小开放**的个人历程，供各机构在统一身份与版本语义下交换记录。

无第三方运行时依赖，仅用 Node 标准库（`node:http` / `node:crypto`）。

## 三条领域红线

1. **观察性评语不伪装成统一分数。** 师傅评语（`MASTER_COMMENT_ISSUED`）只存叙述与"为何不评分"，结构层直接拒绝携带 `score`；数值成绩仅限安全考核与传承人结业考核。
2. **传统工序的核心步骤须由具资格传承人确认。** 名录（`data/directory.json`）登记工序的核心步骤与传承人资格凭证；凡记录触及核心步骤，必须携带在有效期内、且覆盖该工序的传承人凭证，带教师傅不能越权确认。
3. **学校结业不自动等于门店授权。** `ASSESSMENT_SIGNED`（结业）不产生上岗资格；门店独立上岗必须另有 `AUTHORIZATION_GRANTED`，且前置满足"安全考核通过 + 传承人考核覆盖所授权核心步骤 + 授权人具资格"。

另有：跨工作室、课程调整、师傅退出时，**旧履历永不删除、保持可引用**，新关系以新事件另行生效；培训补助必须**逐笔对应**真实的学习/考核/就业事件。

## 资料结构

| 路径 | 作用 |
| --- | --- |
| `contracts/domain.schema.json` | 跨机构交换的公共信封、稳定事件/聚合枚举与 payload 字段约定 |
| `src/vocabulary.js` | 运行时的同一份词汇（事件→聚合归属、各事件 payload 形状、可评分白名单），与 schema 由测试强制一致 |
| `src/domain.ts` | 公共字段的 TypeScript 类型 |
| `src/validator.js` | 单事件结构校验（无状态） |
| `src/rules.js` | 跨事件语义不变量（资格、授权前置、补助对应、关系先后顺序） |
| `src/directory.js` + `data/directory.json` | 名录：人员、传承人资格凭证、工序与核心步骤、机构 |
| `src/store.js` | 只追加事件存储：聚合版本、event_id 幂等、SHA-256 哈希链、可选 JSONL 持久化 |
| `src/service.js` | 写入入口：结构校验 → 语义规则 → 分配版本 → 入链 |
| `src/policy.js` | 隐私与数据最小化：联系方式/未公开作品/叙述评语的按角色裁剪 |
| `src/projections.js` | 读模型：个人历程时间线、门店工序授权矩阵、补助核验报告 |
| `src/certificates.js` | 阶段证明：规范化摘要 + Ed25519 签名 + 验签/对账本强校验 |
| `src/app.js` / `server.js` | HTTP 接口与启动入口 |
| `examples/fixture.mjs` | 一条完整中文联调场景（报名→…→就业→师傅退出接续） |
| `data/sample.scenario.json` | 上述场景生成的事件快照（21 条） |
| `tests/` | 57 项测试：契约一致性、规则、隐私、投影、哈希链、证明、HTTP |

## 事件一览

报名：`ENROLLMENT_ELIGIBILITY_DECIDED` → `ENROLLMENT_CONFIRMED`
师徒：`MENTORSHIP_LINKED` / `MENTORSHIP_ENDED` / `RELATIONSHIP_SUPERSEDED`
课程：`COURSE_REVISION_PUBLISHED`
练习与作品：`PRACTICE_RECORDED` / `WORK_BATCH_SUBMITTED` / `MASTER_COMMENT_ISSUED`
考核与授权：`SAFETY_EXAM_PASSED` / `ASSESSMENT_SIGNED` / `AUTHORIZATION_GRANTED` / `AUTHORIZATION_REVOKED`
上岗与就业：`TRIAL_ARRANGED` / `TRIAL_EVALUATED` / `PLACEMENT_VERIFIED`
政策与凭证：`SUBSIDY_DISBURSED` / `CONTACT_POLICY_ACKNOWLEDGED` / `STAGE_CERTIFICATE_ISSUED`

## 本地运行

```bash
npm test            # 运行全部测试（57 项）
npm run scenario    # 重新生成 data/sample.scenario.json
npm start           # 启动 HTTP 服务（默认 8080，内存存储）
```

持久化与密钥可用环境变量：`LEDGER_FILE`（JSONL 路径）、`PORT`、`SIGNER_KEY`/`SIGNER_PUBKEY`/`SIGNER_KEY_ID`（Ed25519 PEM；缺省进程启动时临时生成）。

## HTTP 接口

观察者身份用请求头传入（演示用，生产应换成真实鉴权）：`x-viewer-role`（`self|studio_mentor|school|shop|district|fiscal|public`）、`x-viewer-party-id`、`x-viewer-person-id`；缺省为最受限的公众视角。

```
GET  /health
POST /events                              # 写入事件（结构+语义通过才落库）
GET  /events?person_id=                   # 事件（按观察者裁剪）
GET  /persons/:id/resume                  # 个人可核验历程（含师徒阶段 epoch）
GET  /persons/:id/authorization?craft=&steps=a,b&at=   # 门店逐步骤判定能否独立上岗
GET  /persons/:id/subsidy-report          # 补助核验（district/fiscal 最小化字段）
POST /persons/:id/certificates            # 导出阶段证明 {stage, included_event_ids}
POST /certificates/verify                 # 验证明 {certificate, against_ledger}
GET  /verification-key                    # 证明验签公钥（PEM）
```

### 门店如何判断"能承担哪些工序"

`GET /persons/:id/authorization?craft=metal_repousse&steps=mr:chase,mr:anneal` 返回该时刻在有效期内的独立授权集合，以及 `check.ok / check.missing`。授权来自 `AUTHORIZATION_GRANTED` 并被 `AUTHORIZATION_REVOKED` 收敛；学校结业不会出现在这里。

### 学员如何导出可验证的阶段证明

`POST /persons/:id/certificates` 只把所选事件的**结构化要点与事件哈希**（不含未公开作品内容、不含联系方式）做规范化摘要并用中心 Ed25519 私钥签名。任一方取 `GET /verification-key` 即可验签；`against_ledger=true` 还会把证明中每条事件与账本逐条核对哈希并重验整条哈希链——任何事后改动都会暴露。

## 隐私与数据最小化

- **联系方式**：仅本人，或经其 `CONTACT_POLICY_ACKNOWLEDGED` 明确授权的机构可见；`district`/`fiscal` 做政策核验时一律看不到。
- **未公开作品**：批次标记 `protected_work + restricted`，作品名、师承署名等细节仅本人、当前在带师傅/工作室、批次 `allowed_party_ids` 可见；师傅退出後旧关系不再授予访问权。
- **叙述性评语**：仅本人、师傅/工作室与评语作者可见原文；管理核验只见结论性字段。
- 被裁剪字段在返回中以 `_redactions` 列明，做到"看不到什么"可审计。

## 设计要点

- **事件溯源 / 只追加**：所有状态（授权矩阵、时间线、补助对账）都是事件的投影，可随时重放；没有"删除/覆盖"。
- **哈希链**：每条事件对"规范化正文 + 前一条哈希"求 SHA-256，`store.verifyChain()` 可发现任何历史改动；规范化按 key 排序，与字段书写顺序无关。
- **版本与幂等**：同一聚合 `version` 单调递增，重复 `event_id` 幂等拒绝；`aggregate_type` 可省略，由事件类型的稳定归属自动填充。
- **关系更替**：`MENTORSHIP_ENDED` + `RELATIONSHIP_SUPERSEDED` 令旧阶段指向新生效关系，旧练习/作品/评语仍归旧阶段且可被引用。
