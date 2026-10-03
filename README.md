# 老字号技艺传习履历

街区文化产业服务中心牵头，把大师工作室、技能学校、门店三方对同一名学员的记录连成一条**可核验的个人传习历程**。本仓库保存领域词汇、跨机构交换事件、不变量校验与证明导出逻辑，是各机构服务协作的起点；不包含具体存储、HTTP 接口与界面实现。

## 资料结构

| 路径 | 内容 |
| --- | --- |
| `contracts/domain.schema.json` | 领域事件公共信封、稳定枚举与出具方定义（JSON Schema 2020-12） |
| `src/domain.ts` | 同一套约定的 TypeScript 类型 |
| `src/validator.js` | 两层校验：单条事件信封 + 整条传习流的跨事件不变量 |
| `src/crypto.js` | 规范化摘要、学员哈希链、Ed25519 事件签名（仅用 Node 内置 `crypto`） |
| `src/projections.js` | 读取模型：工序授权视图、时间线、按授权脱敏、补助核验、阶段证明导出/验证 |
| `data/sample.json` | 一条最小事件样例 |
| `data/sample_stream.json` | 一名学员从报名到就业、再到师傅退出接替的完整合法流（18 条） |
| `tests/` | 31 项测试：信封、红线、哈希链、读取模型、证明验签、schema 一致性 |

## 一条履历由哪些事件构成

事件只追加、不修改；事实错误用新事件纠正。业务字段统一放在 `payload`，信封字段全机构统一。

| 事件 | 出具方 | 含义 |
| --- | --- | --- |
| `ENROLLMENT_ELIGIBILITY_RECORDED` | 中心 / 学校 | 联合招生报名资格结论（eligible / ineligible） |
| `MASTER_QUALIFICATION_REGISTERED` | 中心 | 传承人在册资质，覆盖工序列表与有效期 |
| `APPRENTICESHIP_STARTED` / `APPRENTICESHIP_ENDED` | 师傅（结束可由中心） | 师承关系生效与终止；可声明 `supersedes_apprenticeship_id` |
| `COURSE_REVISION_PUBLISHED` | 学校 | 课程版本发布，成绩永远挂在具体版本上 |
| `SCHOOL_GRADE_RECORDED` | 学校 | 课时与成绩（学校语义） |
| `PRACTICE_RECORDED` | 师傅 | 现场练习：工序、步骤、时长（手上功夫的过程） |
| `WORK_BATCH_SUBMITTED` | 师傅 / 学员 | 作品批次，`visibility` 为 private 或 public |
| `CORE_STEP_CONFIRMED` | 师傅 | 传统工序核心步骤达标确认，只记录 pass |
| `MASTER_NARRATIVE_RECORDED` | 师傅 | 观察性评语（文字与观察维度，**禁止任何分数字段**） |
| `SAFETY_EXAM_PASSED` | 学校 / 中心 | 安全考核通过及有效期 |
| `PROCESS_AUTHORIZATION_GRANTED` / `..._REVOKED` | 门店 | 门店对具体工序步骤的独立/督导上岗授权 |
| `TRIAL_EMPLOYMENT_VERIFIED` | 门店 | 岗位试用核验，必须引用一次真实授权 |
| `PLACEMENT_VERIFIED` | 门店 | 就业去向，引用试用核验 |
| `STAGE_CERTIFICATE_ISSUED` | 中心 | 阶段证明的链上登记 |
| `ACCESS_GRANTED` | 学员本人 | 向具体机构/人员开放 scope，可设有效期 |

## 三条语义红线（校验器强制执行）

1. **观察性评语不能伪装成统一分数。** `MASTER_NARRATIVE_RECORDED` 的 payload 出现 `score`、`grade`、`rating` 等任一分数字段即非法；成绩只能由学校以 `SCHOOL_GRADE_RECORDED` 出具。
2. **核心步骤只能由具备资格的传承人确认。** 确认者必须是该师承关系的师傅本人，其在册资质存在、在有效期内、且覆盖该工序。资质过期、不覆盖工序、非本人师承，全部拒绝。
3. **学校结业不自动等于门店授权。** `PROCESS_AUTHORIZATION_GRANTED` 只承认两类依据：有效期内的安全考核 + 每个被授权步骤在先的传承人核心步骤确认。拿学校成绩编号冒充确认依据会被判 `BAD_BASIS`。试用还必须引用真实且工序一致的授权，就业再引用试用。

其他跨事件约束：师承建立前须有合格报名资格；练习与确认只能发生在师承有效期内；课程改版后旧版本成绩仍有效但必须与版本号一致；同一聚合 `version` 从 1 连续递增；学员链上事件时间不得倒流。

## 接替与版本：旧履历永远可引用

- 学员跨工作室或师傅退出：旧师承以 `APPRENTICESHIP_ENDED` 终止，新师承用新的 `apprenticeship_id` 另行生效并声明接替来源；旧练习、确认、评语原样保留，时间线中旧关系标注 `ended`。
- 课程调整：发布新的 `COURSE_REVISION_PUBLISHED`，旧成绩继续挂旧版本、不被重写。
- 授权可撤销、可到期；撤销/到期后授权视图回到 `none`，但历史授权事件仍在链上。

## 可核验性

**哈希链。** 同一学员的事件用 `prev_event_id` 首尾相接，每节摘要为 SHA-256（规范化 JSON，去掉 `signature`），流指纹为 `SHA-256(前节指纹 ‖ 本节摘要)`。插入、删除、改写任意一条都会改变指纹并被 `CHAIN_BROKEN` / `CHAIN_MISSING` 检出。

**出具方签名。** 机构写入时可用 Ed25519 对单条事件签名（`src/crypto.js` 的 `signEvent`），接收方用出具方公钥验证；签名不参与事件摘要。

**阶段证明（学员导出）。** `exportStageCertificate` 产出一个自包含文件：

- `events`：截至某条事件的学员链片段；`reference_events`：片段引用到的在册资质、课程版本等公开参照事实（门店可离线复核传承人资格）；
- `event_digests` / `reference_digests`：逐条摘要；`chain_hash`：流指纹；
- `signature`：街区中心用 Ed25519 对规范化证明体的签名。

`verifyStageCertificate` 重算全部摘要与指纹、检查链指针、验中心签名，并可重放全部领域不变量。篡改内容、伪造签名、删减事件都会失败。

## 隐私：按身份最小化开放

未公开作品（`visibility: private`）与联系方式默认只对学员本人可见；学员通过 `ACCESS_GRANTED` 向具体机构人员授予 scope（如 `unpublished_works`、`master_narrative`、`learner_contact`），可设有效期，过期自动重新封闭。

- 门店招聘：`viewForParty` 按授权脱敏，外加 `processAuthorizationView` 直接回答"现在能独立承担哪些工序步骤"；
- 管理部门：`subsidyVerificationView` 只返回报名资格、课时成绩、安全考核、授权、试用、就业这些补助核验事实，不含评语原文、联系方式、未公开作品；
- 学员本人：`timeline` 看到完整且可导出的成长历程。

## 本地检查

```bash
npm test
```

零第三方依赖，需要 Node 18+（Ed25519 与原生测试运行器）。
