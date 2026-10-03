/**
 * 完整中文联调场景：学员林夏在朵云金属作大师工作室 + 金城技师学院联合培养，
 * 经报名→师徒（赵丽带练）→课程版本→现场练习/未公开作品→师傅观察评语→安全考核→
 * 传承人结业考核→门店独立上岗授权→岗位试用→就业核验→分阶段培训补助，
 * 末尾赵丽退出、改由传承人陈宝善带教（旧履历保持可引用）。
 *
 * 直接运行可生成快照：node examples/fixture.mjs
 */
import { writeFileSync } from "node:fs";

const P = "p:linxia";
const STUDIO = "studio:duyun";
const SCHOOL = "org:jincheng";
const SHOP = "shop:ruiyun";
const ZHAO = "m:zhaoli";
const CHEN = "m:chenbaoshan";
const CHEN_CRED = "cred:chen_001";
const CRAFT = "metal_repousse";

/**
 * 在给定 ledger 上按顺序记录完整场景。
 * @returns {{ ids: Record<string,string>, events: object[] }}
 */
export function buildScenario(ledger) {
  const ids = {};
  const put = (key, event) => {
    const saved = ledger.record(event);
    ids[key] = saved.event_id;
    return saved;
  };

  // 1. 联系方式授权同意（先于任何含联系方式的记录）
  put("consent", {
    event_id: "demo-consent-001",
    event_type: "CONTACT_POLICY_ACKNOWLEDGED",
    aggregate_type: "consent",
    aggregate_id: "consent:linxia",
    occurred_at: "2026-09-01T09:00:00+08:00",
    version: 1,
    summary: "林夏确认联系方式披露范围",
    policy_context: { sensitivity: "standard", visibility: "restricted" },
    payload: {
      actor_id: P,
      reason: "联合招生报名时签署联系方式仅向培养与录用机构开放的告知",
      person_id: P,
      decision: "acknowledged",
      effective_from: "2026-09-01T09:00:00+08:00",
      allowed_party_ids: [STUDIO, SCHOOL, SHOP],
    },
  });

  // 2. 报名资格审核通过（含联系方式，限授权对象）
  put("eligibility", {
    event_id: "demo-eligibility-001",
    event_type: "ENROLLMENT_ELIGIBILITY_DECIDED",
    aggregate_type: "apprenticeship",
    aggregate_id: "apprenticeship:linxia",
    occurred_at: "2026-09-02T10:00:00+08:00",
    version: 1,
    summary: "联合招生报名资格审核：合格",
    policy_context: {
      sensitivity: "standard_with_contact",
      visibility: "restricted",
      contact_fields: ["phone", "address"],
      allowed_party_ids: [STUDIO, SCHOOL, SHOP],
    },
    payload: {
      actor_id: "official:fang",
      reason: "户籍、年龄与培养意向材料齐备",
      person_id: P,
      decision: "eligible",
      studio_id: STUDIO,
      school_id: SCHOOL,
      craft_id: CRAFT,
      contact: { phone: "138-0000-2026", address: "街区青年公寓 3 号 201" },
    },
  });

  // 3. 报名确认
  put("enrollment", {
    event_id: "demo-enrollment-001",
    event_type: "ENROLLMENT_CONFIRMED",
    aggregate_type: "apprenticeship",
    aggregate_id: "apprenticeship:linxia",
    occurred_at: "2026-09-03T14:00:00+08:00",
    version: 2,
    summary: "林夏确认入读金属雕錾联合培养班",
    policy_context: { sensitivity: "standard", visibility: "restricted" },
    reference_ids: ["demo-eligibility-001"],
    payload: {
      actor_id: "official:fang",
      reason: "资格合格且本人确认入学",
      person_id: P,
      decision: "confirmed",
      studio_id: STUDIO,
      school_id: SCHOOL,
      craft_id: CRAFT,
      effective_from: "2026-09-05T08:30:00+08:00",
    },
  });

  // 4. 师徒关系：赵丽带练（非传承人，负责日常练习，核心步骤仍由陈宝善确认）
  put("mentorship_zhao", {
    event_id: "demo-mentor-link-zhao",
    event_type: "MENTORSHIP_LINKED",
    aggregate_type: "mentorship",
    aggregate_id: "mentorship:linxia:zhao",
    occurred_at: "2026-09-05T08:30:00+08:00",
    version: 1,
    summary: "确立师徒关系：赵丽带练林夏",
    policy_context: { sensitivity: "standard", visibility: "restricted" },
    reference_ids: ["demo-enrollment-001"],
    payload: {
      actor_id: STUDIO,
      reason: "工作室安排在带师傅负责日常手把式练习",
      person_id: P,
      mentor_id: ZHAO,
      studio_id: STUDIO,
      craft_id: CRAFT,
      effective_from: "2026-09-05T08:30:00+08:00",
    },
  });

  // 5. 课程版本发布
  put("course_v1", {
    event_id: "demo-course-v1",
    event_type: "COURSE_REVISION_PUBLISHED",
    aggregate_type: "course_revision",
    aggregate_id: "course:jincheng:metal:v2026",
    occurred_at: "2026-09-06T09:00:00+08:00",
    version: 1,
    summary: "金城技师学院发布金属雕錾课程 2026 版",
    policy_context: { sensitivity: "standard", visibility: "public_verifiable" },
    payload: {
      actor_id: SCHOOL,
      reason: "年度课程修订，新增安全操作模块",
      school_id: SCHOOL,
      craft_id: CRAFT,
      effective_from: "2026-09-08T08:00:00+08:00",
      modules: ["安全基础", "退火热处理", "锤揲成型", "雕錾走线", "压光收尾"],
    },
  });

  // 6. 现场练习（触及核心步骤 mr:chase，须传承人陈宝善确认）
  put("practice_chase", {
    event_id: "demo-practice-chase",
    event_type: "PRACTICE_RECORDED",
    aggregate_type: "practice_evidence",
    aggregate_id: "practice:linxia:0920",
    occurred_at: "2026-09-20T16:00:00+08:00",
    version: 1,
    summary: "现场练习：退火、锤揲并在师傅监督下练习雕錾走线",
    policy_context: { sensitivity: "standard", visibility: "restricted" },
    reference_ids: ["demo-mentor-link-zhao", "demo-course-v1"],
    payload: {
      actor_id: ZHAO,
      reason: "记录当日手上功夫练习与工时",
      person_id: P,
      craft_id: CRAFT,
      step_ids: ["mr:anneal", "mr:hammer", "mr:chase"],
      core_step_ids: ["mr:chase"],
      confirmed_by_inheritor_id: CHEN,
      inheritor_credential_id: CHEN_CRED,
      course_revision_id: "course:jincheng:metal:v2026",
      mentor_id: ZHAO,
      hours: 6,
      attribution: {
        apprentice_contribution: "独立完成退火与锤揲，雕錾在监督下行錾",
        mentor_contribution: "握錾姿态校正与走线示范",
        under_supervision_of: ZHAO,
      },
    },
  });

  // 7. 未公开试岗作品批次（protected_work，仅授权人员可见）
  put("batch_001", {
    event_id: "demo-batch-001",
    event_type: "WORK_BATCH_SUBMITTED",
    aggregate_type: "work_batch",
    aggregate_id: "batch:linxia:001",
    occurred_at: "2026-09-22T17:30:00+08:00",
    version: 1,
    summary: "提交试岗作品批次（未公开）",
    policy_context: {
      sensitivity: "protected_work",
      visibility: "restricted",
      allowed_party_ids: [STUDIO, SHOP],
    },
    reference_ids: ["demo-practice-chase"],
    payload: {
      actor_id: P,
      reason: "门店试岗前提交作品，要求作品细节仅向工作室与门店开放",
      person_id: P,
      craft_id: CRAFT,
      batch_id: "batch:linxia:001",
      is_public: false,
      work_titles: ["缠枝纹银片试作"],
      step_ids: ["mr:hammer", "mr:chase"],
      core_step_ids: ["mr:chase"],
      confirmed_by_inheritor_id: CHEN,
      inheritor_credential_id: CHEN_CRED,
      mentor_id: ZHAO,
      attribution: {
        apprentice_contribution: "纹样主体锤揲与雕錾",
        mentor_contribution: "图样审定",
        under_supervision_of: ZHAO,
      },
    },
  });

  // 8. 师傅观察性评语（只叙述，不评分）
  put("comment_1", {
    event_id: "demo-comment-001",
    event_type: "MASTER_COMMENT_ISSUED",
    aggregate_type: "master_comment",
    aggregate_id: "comment:linxia:001",
    occurred_at: "2026-09-23T11:00:00+08:00",
    version: 1,
    summary: "师傅对雕錾手感的阶段性观察",
    policy_context: { sensitivity: "standard", visibility: "restricted" },
    reference_ids: ["demo-practice-chase", "demo-batch-001"],
    payload: {
      actor_id: CHEN,
      reason: "核心步骤练习后由传承人留下带教观察",
      person_id: P,
      mentor_id: ZHAO,
      craft_id: CRAFT,
      batch_id: "batch:linxia:001",
      observations:
        "下錾力度较月初明显收敛，长直线接头处仍偶有迟疑；银片退火火候判断尚需多上手，不宜以一次作品论定水平。",
      scoring_forbidden_reason: "手感、节奏与判断力属于长期观察，不宜折算为跨学员可比较的统一分数",
    },
  });

  // 9. 安全考核通过（量化成绩只用于安全考核）
  put("safety", {
    event_id: "demo-safety-001",
    event_type: "SAFETY_EXAM_PASSED",
    aggregate_type: "safety_exam",
    aggregate_id: "safety:linxia:metal",
    occurred_at: "2026-10-10T10:00:00+08:00",
    version: 1,
    summary: "金属雕錾安全操作考核通过",
    policy_context: { sensitivity: "standard", visibility: "public_verifiable" },
    payload: {
      actor_id: SCHOOL,
      reason: "学校组织的安全规程与现场操作考核",
      person_id: P,
      craft_id: CRAFT,
      school_id: SCHOOL,
      decision: "passed",
      effective_from: "2026-10-10T10:00:00+08:00",
      score: { score_kind: "safety_exam", value: 92, scale_max: 100, pass_threshold: 60 },
    },
  });

  // 10. 传承人签署结业考核（学校结业，本身不等于门店授权）
  put("assessment", {
    event_id: "demo-assessment-001",
    event_type: "ASSESSMENT_SIGNED",
    aggregate_type: "skill_assessment",
    aggregate_id: "assessment:linxia:metal",
    occurred_at: "2026-10-12T15:00:00+08:00",
    version: 1,
    summary: "传承人陈宝善签署结业考核，确认核心步骤达成",
    policy_context: { sensitivity: "standard", visibility: "public_verifiable" },
    reference_ids: ["demo-practice-chase", "demo-safety-001"],
    payload: {
      actor_id: CHEN,
      reason: "结业技能考核，核心步骤由具资格传承人当面确认",
      person_id: P,
      craft_id: CRAFT,
      decision: "completed",
      step_ids: ["mr:anneal", "mr:hammer"],
      core_step_ids: ["mr:chase"],
      confirmed_by_inheritor_id: CHEN,
      inheritor_credential_id: CHEN_CRED,
      course_revision_id: "course:jincheng:metal:v2026",
      effective_from: "2026-10-12T15:00:00+08:00",
      score: { score_kind: "course_grade", value: 88, scale_max: 100 },
    },
  });

  // 11. 门店独立上岗授权（独立于学校结业，满足安全+传承人考核前置）
  put("authorization", {
    event_id: "demo-authz-001",
    event_type: "AUTHORIZATION_GRANTED",
    aggregate_type: "work_authorization",
    aggregate_id: "authz:linxia:metal",
    occurred_at: "2026-10-13T09:30:00+08:00",
    version: 1,
    summary: "门店授权林夏可独立承担雕錾走线与锤揲成型",
    policy_context: { sensitivity: "standard", visibility: "public_verifiable" },
    reference_ids: ["demo-assessment-001", "demo-safety-001"],
    payload: {
      actor_id: CHEN,
      reason: "安全考核通过、传承人确认核心步骤，门店准予相应步骤独立上岗",
      person_id: P,
      craft_id: CRAFT,
      decision: "granted",
      authorized_step_ids: ["mr:chase", "mr:hammer"],
      scope: "独立上岗",
      confirmed_by_inheritor_id: CHEN,
      inheritor_credential_id: CHEN_CRED,
      effective_from: "2026-10-13T09:30:00+08:00",
    },
  });

  // 12. 岗位试用安排
  put("trial_arranged", {
    event_id: "demo-trial-arranged",
    event_type: "TRIAL_ARRANGED",
    aggregate_type: "job_trial",
    aggregate_id: "trial:linxia:ruiyun",
    occurred_at: "2026-10-15T08:00:00+08:00",
    version: 1,
    summary: "瑞云银楼安排林夏岗位试用",
    policy_context: { sensitivity: "standard", visibility: "restricted" },
    reference_ids: ["demo-authz-001", "demo-batch-001"],
    payload: {
      actor_id: SHOP,
      reason: "依据作品批次与授权安排两周跟岗试用",
      person_id: P,
      shop_id: SHOP,
      craft_id: CRAFT,
      effective_from: "2026-10-16T09:00:00+08:00",
      trial_step_ids: ["mr:chase", "mr:hammer"],
    },
  });

  // 13. 试用评定：可独立上岗（须有有效期内授权支撑）
  put("trial_evaluated", {
    event_id: "demo-trial-evaluated",
    event_type: "TRIAL_EVALUATED",
    aggregate_type: "job_trial",
    aggregate_id: "trial:linxia:ruiyun",
    occurred_at: "2026-10-30T17:00:00+08:00",
    version: 2,
    summary: "试用评定：可独立上岗",
    policy_context: { sensitivity: "standard", visibility: "restricted" },
    reference_ids: ["demo-trial-arranged"],
    payload: {
      actor_id: SHOP,
      reason: "试用期间独立完成授权步骤，质量稳定",
      person_id: P,
      shop_id: SHOP,
      craft_id: CRAFT,
      trial_result: "independent_ready",
      observations: "两周内独立承接三笔来料加工，未见安全问题",
    },
  });

  // 14. 就业去向核验
  put("placement", {
    event_id: "demo-placement-001",
    event_type: "PLACEMENT_VERIFIED",
    aggregate_type: "placement",
    aggregate_id: "placement:linxia",
    occurred_at: "2026-11-01T10:00:00+08:00",
    version: 1,
    summary: "就业核验：林夏入职瑞云银楼",
    policy_context: { sensitivity: "standard", visibility: "public_verifiable" },
    reference_ids: ["demo-trial-evaluated"],
    payload: {
      actor_id: "official:fang",
      reason: "凭劳动合同与门店试用评定核验就业去向",
      person_id: P,
      shop_id: SHOP,
      craft_id: CRAFT,
      employment_status: "employed",
      employer_name: "瑞云银楼门店",
      effective_from: "2026-11-01T10:00:00+08:00",
    },
  });

  // 15. 分阶段培训补助，每笔都对应真实学习/考核/就业事件
  const subsidy = (key, id, at, stage, amount, evidence) =>
    put(key, {
      event_id: id,
      event_type: "SUBSIDY_DISBURSED",
      aggregate_type: "subsidy",
      aggregate_id: `subsidy:linxia:${stage}`,
      occurred_at: at,
      version: 1,
      summary: `培训补助（${stage} 阶段）`,
      policy_context: { sensitivity: "standard", visibility: "restricted" },
      reference_ids: evidence,
      payload: {
        actor_id: "official:fang",
        reason: `${stage} 阶段补助，凭对应记录拨付`,
        person_id: P,
        subsidy: { amount, currency: "CNY", stage, evidence_event_ids: evidence },
      },
    });

  subsidy("subsidy_enroll", "demo-subsidy-enroll", "2026-09-04T10:00:00+08:00", "enrollment", 1000, ["demo-enrollment-001"]);
  subsidy("subsidy_train", "demo-subsidy-train", "2026-10-08T10:00:00+08:00", "training", 2000, ["demo-practice-chase"]);
  subsidy("subsidy_assess", "demo-subsidy-assess", "2026-10-13T10:00:00+08:00", "assessment", 1500, ["demo-safety-001", "demo-assessment-001"]);
  subsidy("subsidy_employ", "demo-subsidy-employ", "2026-11-02T10:00:00+08:00", "employment", 3000, ["demo-placement-001"]);

  // 16. 师傅退出：结束旧师徒关系并指向新生效关系（旧履历不删除、仍可引用）
  put("mentorship_ended", {
    event_id: "demo-mentor-end-zhao",
    event_type: "MENTORSHIP_ENDED",
    aggregate_type: "mentorship",
    aggregate_id: "mentorship:linxia:zhao",
    occurred_at: "2026-11-03T09:00:00+08:00",
    version: 2,
    summary: "赵丽因个人原因退出带教",
    policy_context: { sensitivity: "standard", visibility: "restricted" },
    reference_ids: ["demo-mentor-link-zhao"],
    payload: {
      actor_id: STUDIO,
      reason: "带教师傅退出，工作室安排传承人接续带教",
      exit_reason: "mentor_exit",
      effective_until: "2026-11-03T09:00:00+08:00",
      new_aggregate_id: "mentorship:linxia:chen",
    },
  });

  put("supersede", {
    event_id: "demo-relationship-supersede",
    event_type: "RELATIONSHIP_SUPERSEDED",
    aggregate_type: "apprenticeship",
    aggregate_id: "apprenticeship:linxia",
    occurred_at: "2026-11-03T09:05:00+08:00",
    version: 3,
    summary: "师徒关系更替：旧关系履历保持可引用，新关系另行生效",
    policy_context: { sensitivity: "standard", visibility: "restricted" },
    reference_ids: ["demo-mentor-link-zhao", "demo-mentor-end-zhao"],
    payload: {
      actor_id: STUDIO,
      reason: "师傅退出，新生效关系另行记录，原有练习/作品/评语仍归属于旧关系并可引用",
      exit_reason: "mentor_exit",
      new_aggregate_id: "mentorship:linxia:chen",
      effective_from: "2026-11-03T09:05:00+08:00",
    },
  });

  put("mentorship_chen", {
    event_id: "demo-mentor-link-chen",
    event_type: "MENTORSHIP_LINKED",
    aggregate_type: "mentorship",
    aggregate_id: "mentorship:linxia:chen",
    occurred_at: "2026-11-03T09:10:00+08:00",
    version: 1,
    summary: "确立新生效师徒关系：陈宝善接续带教",
    policy_context: { sensitivity: "standard", visibility: "restricted" },
    reference_ids: ["demo-relationship-supersede"],
    payload: {
      actor_id: STUDIO,
      reason: "由具资格传承人接续带教，旧练习与作品批次继续有效",
      person_id: P,
      mentor_id: CHEN,
      studio_id: STUDIO,
      craft_id: CRAFT,
      effective_from: "2026-11-03T09:10:00+08:00",
    },
  });

  return { ids, events: ledger.store.events };
}

const IDS = {
  P,
  STUDIO,
  SCHOOL,
  SHOP,
  ZHAO,
  CHEN,
  CHEN_CRED,
  CRAFT,
};
export { IDS as FIXTURE_IDS };

// 直接运行时生成快照
if (import.meta.url === `file://${process.argv[1]}`) {
  const { ApprenticeLedger } = await import("../src/service.js");
  const { Directory } = await import("../src/directory.js");
  const { EventStore } = await import("../src/store.js");
  const directory = await Directory.load(new URL("../data/directory.json", import.meta.url));
  const ledger = new ApprenticeLedger({ directory });
  const { events } = buildScenario(ledger);
  writeFileSync(new URL("../data/sample.scenario.json", import.meta.url), JSON.stringify(events, null, 2) + "\n");
  console.log(`已生成 ${events.length} 条事件到 data/sample.scenario.json`);
}
