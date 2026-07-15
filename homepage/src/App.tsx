import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { VillageMapSection } from '@/features/village-map/VillageMapSection';
import { DEFAULT_VILLAGE_ID, getVillageById } from '@/features/village-map/village-data.js';
import { 
  MapPin, 
  BookOpen, 
  AlertTriangle, 
  Compass, 
  ArrowRight,
  ArrowUp,
  CheckCircle2,
  Clock,
  FileText,
  User,
  UserPlus,
  LogOut,
  Menu,
  X,
  Trees,
  Home,
  GraduationCap,
  Map,
  Leaf,
  MessageSquareText
} from 'lucide-react';

type IntroStep = {
  id: string;
  label: string;
  type: 'intro';
  title: string;
  content: string;
  question: string;
  placeholder: string;
  storageKey: string;
};

type ReadingStep = {
  id: string;
  label: string;
  type: 'reading';
  title: string;
  guideTitle: string;
  guidePoints: string[];
};

type TaskStep = {
  id: string;
  label: string;
  type: 'task';
  title: string;
  content: string;
  relatedPages: string;
  checklist: string[];
  placeholder: string;
  storageKey: string;
  mapTask: string;
};

type ReflectionStep = {
  id: string;
  label: string;
  type: 'reflection';
  title: string;
  question: string;
  hint: string;
  placeholder: string;
  storageKey: string;
};

type LessonStep = IntroStep | ReadingStep | TaskStep | ReflectionStep;

type Lesson = {
  id: string;
  number: string;
  title: string;
  shortTitle: string;
  pdfPath: string;
  displayPdfPath: string;
  pageCount: number;
  description: string;
  tag: string;
  steps: LessonStep[];
};

const pdfPathFor = (lessonId: string) => `../../assets/lessons/${lessonId}.pdf`;
const displayPdfPathFor = (lessonId: string) => `assets/lessons/${lessonId}.pdf`;

const lessons: Lesson[] = [
  {
    id: 'lesson01',
    number: '第一讲',
    title: '民居、聚落与乡村',
    shortTitle: '认识乡村',
    pdfPath: pdfPathFor('lesson01'),
    displayPdfPath: displayPdfPathFor('lesson01'),
    pageCount: 49,
    description: '理解民居、聚落与乡村的递进关系，建立“单元—组织—系统”的村庄认知框架。',
    tag: '已开放',
    steps: [
      { id: 'intro', label: '导入问题', type: 'intro', title: '我们真的理解乡村吗？', content: '乡村只是房子多的地方吗？村庄只是空间集合吗？请带着这个问题进入本讲学习。', question: '你认为乡村仅仅是房屋的集合吗？为什么？', placeholder: '请写下你对乡村的初步理解……', storageKey: 'lesson01_intro' },
      { id: 'reading', label: 'PPT 阅读', type: 'reading', title: '课程 PPT 原文', guideTitle: '阅读提示', guidePoints: ['关注民居、聚落、乡村三者的递进关系', '关注民居为什么是村庄规划的基本单元', '关注聚落为什么不是建筑的简单堆叠', '关注乡村为什么是社会、产业、空间共同构成的系统'] },
      { id: 'house_observation', label: '民居观察', type: 'task', title: '从一栋房子理解村庄', content: '民居不仅是居住建筑，还关联宅基地、道路、给排水、公共服务和村庄风貌。', relatedPages: 'PPT 第 7—25 页', checklist: ['已选择一栋民居', '已观察它与道路的关系', '已观察它与院落或公共空间的关系', '已写下简短说明'], placeholder: '请记录这栋民居与道路、院落、公共空间之间的关系……', storageKey: 'lesson01_house_observation', mapTask: 'house_observation' },
      { id: 'settlement_recognition', label: '聚落识别', type: 'task', title: '从建筑集合到聚落组织', content: '聚落不是房屋的简单堆叠，而是由民居、道路、水源、土地、公共空间和社会生活共同组织起来的空间。', relatedPages: 'PPT 第 27—30 页', checklist: ['识别民居', '识别道路', '识别水体或水源', '识别农田或生产空间', '识别公共空间或社会生活节点'], placeholder: '请写下你对本村聚落结构的理解……', storageKey: 'lesson01_settlement_observation', mapTask: 'settlement_elements' },
      { id: 'rural_system', label: '乡村系统', type: 'task', title: '从聚落走向乡村系统', content: '乡村包含社会系统、产业系统和空间系统。空间系统中又包括生产空间、生活空间、生态空间和基础设施。', relatedPages: 'PPT 第 32—47 页', checklist: ['建筑：居住生活系统', '农田：生产系统', '水体 / 山体 / 林地：生态系统', '道路：基础设施系统', '祠堂 / 村委 / 广场：社会系统'], placeholder: '请写下你认为本村最突出的系统特征……', storageKey: 'lesson01_system_observation', mapTask: 'rural_system_classification' },
      { id: 'reflection', label: '小结反思', type: 'reflection', title: '本讲反思', question: '为什么说乡村不仅是空间集合？', hint: '请结合“民居是单元、聚落是组织、乡村是系统”的关系，写下你的理解。', placeholder: '请结合“民居是单元、聚落是组织、乡村是系统”的关系，写下你的理解……', storageKey: 'lesson01_reflection' }
    ]
  },
  {
    id: 'lesson02',
    number: '第二讲',
    title: '乡村的类型',
    shortTitle: '识别类型',
    pdfPath: pdfPathFor('lesson02'),
    displayPdfPath: displayPdfPathFor('lesson02'),
    pageCount: 54,
    description: '学习行政属性、空间区位、经济功能、文化价值等多维乡村分类方法。',
    tag: '已开放',
    steps: [
      { id: 'intro', label: '导入问题', type: 'intro', title: '为什么乡村不能一套标准管到底？', content: '不同乡村在行政属性、空间区位、经济功能、文化价值和发展问题上差异明显，分类是因地制宜规划的前提。', question: '你觉得案例村属于单一类型，还是可能同时具有多种类型特征？', placeholder: '请写下你的初步判断……', storageKey: 'lesson02_intro' },
      { id: 'reading', label: 'PPT 阅读', type: 'reading', title: '课程 PPT 原文', guideTitle: '阅读提示', guidePoints: ['关注乡村分类的意义', '关注行政村与自然村的区别', '关注城中村、近郊村、远郊村的差异', '关注农业、特色产业、电商、旅游等功能类型', '关注传统村落、红色文化村、空心村等特殊类型'] },
      { id: 'administrative_type', label: '行政属性', type: 'task', title: '行政村与自然村识别', content: '行政村是基层治理和资源配置的基本单元，自然村是村民日常生产生活的空间共同体。', relatedPages: 'PPT 第 9—18 页', checklist: ['已判断案例对象更接近行政村还是自然村', '已识别村庄边界或自然组团', '已说明治理单元与生活单元的差异'], placeholder: '请说明案例村中行政村和自然村的关系……', storageKey: 'lesson02_administrative_type', mapTask: 'administrative_natural_village' },
      { id: 'location_type', label: '区位类型', type: 'task', title: '城中村、近郊村与远郊村判断', content: '村庄与城市中心、交通廊道和建设扩张边界的关系，会影响其发展路径和规划策略。', relatedPages: 'PPT 第 20—31 页', checklist: ['已判断案例村与城市的距离关系', '已观察交通联系', '已判断其可能属于城中村、近郊村、远郊村或混合类型'], placeholder: '请写下你的区位类型判断及依据……', storageKey: 'lesson02_location_type', mapTask: 'location_type' },
      { id: 'function_culture_type', label: '功能与文化', type: 'task', title: '经济功能与文化价值类型判断', content: '乡村可能具有农业主导、特色产业、电商、旅游、传统文化、红色文化等多重属性。', relatedPages: 'PPT 第 33—50 页', checklist: ['已识别主要生产或产业资源', '已识别旅游或文化资源', '已判断是否具有传统村落或历史文化价值', '已说明本村主导功能'], placeholder: '请写下本村的功能类型和文化价值判断……', storageKey: 'lesson02_function_culture_type', mapTask: 'function_culture_type' },
      { id: 'hollow_village', label: '空心村识别', type: 'task', title: '识别空心化与外新内旧问题', content: '空心村常表现为内部房屋空置、公共设施闲置、外围新建扩张等空间异化现象。', relatedPages: 'PPT 第 52—54 页', checklist: ['已观察是否存在闲置建筑', '已观察是否存在外新内旧格局', '已判断空心化对公共服务和社区活力的影响'], placeholder: '请写下本村是否存在空心化问题及证据……', storageKey: 'lesson02_hollow_village', mapTask: 'hollow_village' },
      { id: 'reflection', label: '小结反思', type: 'reflection', title: '本讲反思', question: '案例村应该如何进行类型判断？它是单一类型还是复合类型？', hint: '请尝试用区位、功能、问题三个维度综合判断案例村类型。', placeholder: '请用“区位类型 + 功能类型 + 问题类型”的方式总结案例村……', storageKey: 'lesson02_reflection' }
    ]
  },
  {
    id: 'lesson03',
    number: '第三讲',
    title: '乡村规划建设的原理',
    shortTitle: '理解原理',
    pdfPath: pdfPathFor('lesson03'),
    displayPdfPath: displayPdfPathFor('lesson03'),
    pageCount: 76,
    description: '理解乡村规划的性质、体系、基本特性、关键关系与共同缔造方法。',
    tag: '已开放',
    steps: [
      { id: 'intro', label: '导入问题', type: 'intro', title: '乡村为什么需要规划？', content: '乡村规划不是简单画图，而是在生产、生活、生态维度上回应资源低效、人口变化、公共服务不足和生态脆弱等问题。', question: '你认为案例村最需要通过规划解决的问题是什么？', placeholder: '请写下你的初步判断……', storageKey: 'lesson03_intro' },
      { id: 'reading', label: 'PPT 阅读', type: 'reading', title: '课程 PPT 原文', guideTitle: '阅读提示', guidePoints: ['关注乡村规划的定义', '关注乡村规划体系', '关注整体性、等级性、集体性、适应性', '关注效率与公平、土地与建设主体、规划设计建设治理的关系', '关注共同缔造的工作方式'] },
      { id: 'planning_system', label: '规划体系', type: 'task', title: '理解村庄规划所在的规划体系', content: '乡村规划处在国家战略、区域发展、县镇村多层级规划体系之中。', relatedPages: 'PPT 第 8—29 页', checklist: ['已理解县、镇、村多层级规划关系', '已判断本平台对应的是村庄层面的教学实践', '已说明村庄规划与上位规划之间的关系'], placeholder: '请写下你对村庄规划层级关系的理解……', storageKey: 'lesson03_planning_system', mapTask: 'planning_system' },
      { id: 'planning_features', label: '基本特性', type: 'task', title: '整体性、等级性、集体性、适应性', content: '乡村规划既要看整体系统，也要处理不同层级、集体利益和地方适应性问题。', relatedPages: 'PPT 第 31—40 页', checklist: ['已识别一个需要整体统筹的问题', '已识别一个涉及不同层级的问题', '已识别一个涉及集体利益的问题', '已识别一个需要因地制宜的问题'], placeholder: '请结合地图对象写下你对规划特性的理解……', storageKey: 'lesson03_planning_features', mapTask: 'planning_features' },
      { id: 'relationship_analysis', label: '关系辨析', type: 'task', title: '效率、公平、土地、主体与治理', content: '乡村规划需要处理效率与公平、土地性质与建设主体、规划设计建设治理之间的复杂关系。', relatedPages: 'PPT 第 42—54 页', checklist: ['已选择一个空间冲突或利益冲突点', '已说明涉及哪些主体', '已说明可能存在的公平或效率问题', '已提出初步协调方式'], placeholder: '请记录一个案例村中的规划冲突或协商问题……', storageKey: 'lesson03_relationship_analysis', mapTask: 'planning_relationship' },
      { id: 'co_creation', label: '共同缔造', type: 'task', title: '从专业规划到共同缔造', content: '共同缔造强调决策共谋、发展共建、建设共管、效果共评、成果共享。', relatedPages: 'PPT 第 56—76 页', checklist: ['已识别需要村民参与的问题', '已设计一个讨论或协商议题', '已说明规划师在其中的角色'], placeholder: '请写下一个可以通过共同缔造推进的村庄议题……', storageKey: 'lesson03_co_creation', mapTask: 'co_creation' },
      { id: 'reflection', label: '小结反思', type: 'reflection', title: '本讲反思', question: '乡村规划师在共同缔造中应该扮演什么角色？', hint: '请结合学习者、组织者、宣传者、协调者等角色写下你的理解。', placeholder: '请结合学习者、组织者、宣传者、协调者等角色写下你的理解……', storageKey: 'lesson03_reflection' }
    ]
  },
  {
    id: 'lesson04',
    number: '第四讲',
    title: '村域总体规划',
    shortTitle: '总体规划',
    pdfPath: pdfPathFor('lesson04'),
    displayPdfPath: displayPdfPathFor('lesson04'),
    pageCount: 125,
    description: '学习村域总体规划的定义、现状分析、功能布局、专项规划和工作路径。',
    tag: '已开放',
    steps: [
      { id: 'intro', label: '导入问题', type: 'intro', title: '村域总体规划到底规划什么？', content: '村域总体规划不是只画村庄建设图，而是对产业、居民点、公共服务、基础设施、土地利用、生态保护和实施路径的综合安排。', question: '你认为一个村域总体规划最应该先解决什么问题？', placeholder: '请写下你的初步判断……', storageKey: 'lesson04_intro' },
      { id: 'reading', label: 'PPT 阅读', type: 'reading', title: '课程 PPT 原文', guideTitle: '阅读提示', guidePoints: ['关注村域总体规划的定义、对象和任务', '关注现状基础与发展定位', '关注功能布局和产业规划', '关注居民点、道路交通、公共服务设施', '关注厕污垃、土地利用和工作路径'] },
      { id: 'current_analysis', label: '现状与定位', type: 'task', title: '现状基础与发展定位分析', content: '总体规划首先要识别村庄现状资源、问题短板和发展定位。', relatedPages: 'PPT 第 21—50 页', checklist: ['已识别自然环境资源', '已识别建设现状问题', '已识别产业或公共服务基础', '已提出一个初步发展定位'], placeholder: '请写下本村的现状基础、核心问题和发展定位……', storageKey: 'lesson04_current_analysis', mapTask: 'current_positioning' },
      { id: 'function_industry', label: '功能与产业', type: 'task', title: '功能布局与产业规划', content: '村域总体规划需要统筹生产、生活、生态空间，并结合产业资源形成空间布局。', relatedPages: 'PPT 第 38—56 页', checklist: ['已划分生产空间', '已划分生活空间', '已划分生态空间', '已识别产业发展节点'], placeholder: '请写下本村功能布局和产业发展判断……', storageKey: 'lesson04_function_industry', mapTask: 'function_industry_layout' },
      { id: 'settlement_planning', label: '居民点规划', type: 'task', title: '居民点与农房布局规划', content: '居民点规划要处理保留、整治、改造、新建、集聚与闲置空间利用等问题。', relatedPages: 'PPT 第 57—71 页', checklist: ['已识别主要居民点', '已判断哪些建筑应保留或改造', '已判断是否存在闲置宅基地或空心化空间', '已提出居民点优化方向'], placeholder: '请写下居民点规划的初步思路……', storageKey: 'lesson04_settlement_planning', mapTask: 'settlement_planning' },
      { id: 'road_public_service', label: '道路与公服', type: 'task', title: '道路交通与公共服务设施规划', content: '道路交通和公共服务设施决定村民日常出行、服务可达性和村庄运行效率。', relatedPages: 'PPT 第 72—93 页', checklist: ['已识别主要道路骨架', '已识别道路断点或交通问题', '已识别公共服务设施', '已判断服务覆盖不足区域'], placeholder: '请写下道路与公共服务设施优化建议……', storageKey: 'lesson04_road_public_service', mapTask: 'road_public_service' },
      { id: 'sanitation_landuse', label: '厕污垃与用地', type: 'task', title: '厕污垃规划与土地利用管控', content: '村域规划还要回应厕所、污水、垃圾处理和土地用途管控等实施性问题。', relatedPages: 'PPT 第 94—114 页', checklist: ['已识别污水或垃圾问题点', '已识别厕所或环境卫生问题', '已判断土地利用或建设管控问题', '已提出治理或管控建议'], placeholder: '请写下厕污垃和土地利用管控方面的问题与建议……', storageKey: 'lesson04_sanitation_landuse', mapTask: 'sanitation_landuse' },
      { id: 'action_plan', label: '行动计划', type: 'task', title: '工作路径与行动计划', content: '总体规划最终要转化为共谋愿景、完善布局、商定项目、推动实施的行动路径。', relatedPages: 'PPT 第 116—125 页', checklist: ['已总结核心问题', '已提出发展愿景', '已提出近期行动项目', '已说明实施主体或协作方式'], placeholder: '请写下本村的近期行动计划……', storageKey: 'lesson04_action_plan', mapTask: 'action_plan' },
      { id: 'reflection', label: '小结反思', type: 'reflection', title: '本讲反思', question: '一个好的村域总体规划应如何从现状问题转化为行动计划？', hint: '请用“现状问题—发展定位—空间布局—行动项目”的结构回答。', placeholder: '请用“现状问题—发展定位—空间布局—行动项目”的结构回答……', storageKey: 'lesson04_reflection' }
    ]
  },
  {
    id: 'lesson05',
    number: '第五讲',
    title: '乡村设计',
    shortTitle: '乡村设计',
    pdfPath: pdfPathFor('lesson05'),
    displayPdfPath: displayPdfPathFor('lesson05'),
    pageCount: 83,
    description: '学习“千尺审势、百尺造形、十尺提质”的多尺度乡村设计方法。',
    tag: '已开放',
    steps: [
      { id: 'intro', label: '导入问题', type: 'intro', title: '为什么乡村设计不是简单做景观？', content: '乡村设计面对的是人、地、业、文化共同作用下的整体空间，不只是建筑立面或景观美化。', question: '你认为案例村最需要被设计改善的空间是什么？', placeholder: '请写下你的初步判断……', storageKey: 'lesson05_intro' },
      { id: 'reading', label: 'PPT 阅读', type: 'reading', title: '课程 PPT 原文', guideTitle: '阅读提示', guidePoints: ['关注乡村设计的内涵', '关注安全、尺度适宜、本土三大原则', '关注千尺审势、百尺造形、十尺提质', '关注公共空间、街巷、农房、房前屋后等具体对象', '关注从问题识别到设计路径的转化'] },
      { id: 'design_principles', label: '三大原则', type: 'task', title: '安全、尺度适宜与本土', content: '乡村设计需要同时关注安全底线、人的尺度体验和地方文化认同。', relatedPages: 'PPT 第 7—18 页', checklist: ['已识别一个安全风险或隐患', '已识别一个尺度不适宜的问题', '已识别一个风貌或本土性问题'], placeholder: '请写下本村在安全、尺度和本土性方面的问题……', storageKey: 'lesson05_design_principles', mapTask: 'design_principles' },
      { id: 'large_scale', label: '千尺审势', type: 'task', title: '从山水格局和地形环境看村庄', content: '千尺审势关注村庄选址、山水格局、地形、水系、安全和资源组织。', relatedPages: 'PPT 第 19—23 页', checklist: ['已观察地形或等高线', '已观察水系或生态格局', '已判断潜在灾害或安全问题', '已提出整体格局层面的设计建议'], placeholder: '请写下本村在千尺尺度上的空间判断……', storageKey: 'lesson05_large_scale', mapTask: 'large_scale_design' },
      { id: 'middle_scale', label: '百尺造形', type: 'task', title: '从街巷、组团和公共空间看村庄', content: '百尺造形关注村落肌理、街巷组织、公共空间、宗祠、村头和房前屋后等空间关系。', relatedPages: 'PPT 第 24—50 页', checklist: ['已观察街巷肌理', '已识别一个公共空间', '已识别一个房前屋后或过渡空间', '已提出空间组织优化建议'], placeholder: '请写下本村在百尺尺度上的设计问题与建议……', storageKey: 'lesson05_middle_scale', mapTask: 'middle_scale_design' },
      { id: 'small_scale', label: '十尺提质', type: 'task', title: '从农房和日常生活细节提升品质', content: '十尺提质关注农房功能、材料构造、生活设施、日常活动和空间品质。', relatedPages: 'PPT 第 51—82 页', checklist: ['已选择一栋农房或一个生活空间', '已判断其功能或设施短板', '已提出改造或提质建议'], placeholder: '请写下本村在十尺尺度上的提质建议……', storageKey: 'lesson05_small_scale', mapTask: 'small_scale_design' },
      { id: 'design_path', label: '设计路径', type: 'task', title: '形成一个小型乡村设计方案', content: '将千尺、百尺、十尺三个尺度的问题整合，形成一个可解释的设计方案。', relatedPages: 'PPT 第 83 页', checklist: ['已确定设计对象', '已说明设计问题', '已提出设计策略', '已说明预期效果'], placeholder: '请写下一个小型乡村设计方案……', storageKey: 'lesson05_design_path', mapTask: 'design_path' },
      { id: 'reflection', label: '小结反思', type: 'reflection', title: '本讲反思', question: '为什么“千村一面”不是高质量乡村建设？', hint: '请结合安全、尺度适宜、本土和三尺度设计框架回答。', placeholder: '请结合安全、尺度适宜、本土和三尺度设计框架回答……', storageKey: 'lesson05_reflection' }
    ]
  },
  {
    id: 'lesson06',
    number: '第六讲',
    title: '乡村建设实施',
    shortTitle: '建设实施',
    pdfPath: pdfPathFor('lesson06'),
    displayPdfPath: displayPdfPathFor('lesson06'),
    pageCount: 48,
    description: '学习农房建设、基础设施、公共服务设施等从规划到实施的管理方法。',
    tag: '已开放',
    steps: [
      { id: 'intro', label: '导入问题', type: 'intro', title: '方案怎么变成可实施项目？', content: '乡村建设实施关注的不只是方案好不好，还包括程序是否合法、建设是否安全、设施如何运行、后期谁来维护。', question: '你认为村庄规划方案最容易在哪个实施环节出问题？', placeholder: '请写下你的初步判断……', storageKey: 'lesson06_intro' },
      { id: 'reading', label: 'PPT 阅读', type: 'reading', title: '课程 PPT 原文', guideTitle: '阅读提示', guidePoints: ['关注农房建设管理的原则和程序', '关注给水、污水、垃圾等基础设施建设管理', '关注教育、医疗、养老等公共服务设施', '关注实施主体、运行维护和长效机制'] },
      { id: 'house_construction', label: '农房建设', type: 'task', title: '农房建设管理', content: '农房建设需要合法合规、安全可靠、舒适现代、风貌协调，并经过审批、施工和验收等程序。', relatedPages: 'PPT 第 6—22 页', checklist: ['已选择一个新建或改造农房对象', '已判断是否涉及宅基地或审批问题', '已判断是否存在安全或施工问题', '已提出风貌协调建议'], placeholder: '请写下该农房建设或改造的实施管理要点……', storageKey: 'lesson06_house_construction', mapTask: 'house_construction' },
      { id: 'infrastructure', label: '基础设施', type: 'task', title: '给水、污水和垃圾设施实施', content: '基础设施建设需要因地制宜选择模式，并明确收费、运行和维护机制。', relatedPages: 'PPT 第 24—33 页', checklist: ['已识别给水设施或问题', '已识别污水处理设施或问题', '已识别垃圾收运处理问题', '已提出运行维护建议'], placeholder: '请写下基础设施建设与管理建议……', storageKey: 'lesson06_infrastructure', mapTask: 'infrastructure_implementation' },
      { id: 'public_service', label: '公共服务', type: 'task', title: '教育、医疗和养老设施实施', content: '公共服务设施建设需要考虑县域统筹、服务半径、设施等级和兜底保障。', relatedPages: 'PPT 第 35—48 页', checklist: ['已识别教育服务需求', '已识别医疗服务需求', '已识别养老服务需求', '已判断公共服务设施配置是否合理'], placeholder: '请写下公共服务设施实施建议……', storageKey: 'lesson06_public_service', mapTask: 'public_service_implementation' },
      { id: 'project_schedule', label: '项目时序', type: 'task', title: '建立项目库与实施时序', content: '将规划方案拆解为近期、中期和远期项目，明确优先级、实施主体和维护机制。', relatedPages: '综合任务', checklist: ['已提出 3 个近期项目', '已提出 1 个中期或远期项目', '已判断项目优先级', '已说明实施主体或维护方式'], placeholder: '请列出本村近期优先实施项目……', storageKey: 'lesson06_project_schedule', mapTask: 'project_schedule' },
      { id: 'reflection', label: '小结反思', type: 'reflection', title: '本讲反思', question: '一个规划项目要真正落地，除了空间方案外还需要哪些实施条件？', hint: '请从程序、主体、资金、维护和村民参与等角度回答。', placeholder: '请从程序、主体、资金、维护和村民参与等角度回答……', storageKey: 'lesson06_reflection' }
    ]
  },
  {
    id: 'lesson07',
    number: '第七讲',
    title: '乡村建设评价',
    shortTitle: '建设评价',
    pdfPath: pdfPathFor('lesson07'),
    displayPdfPath: displayPdfPathFor('lesson07'),
    pageCount: 88,
    description: '学习乡村建设评价的指标体系、数据采集、问题评价和整改反馈机制。',
    tag: '已开放',
    steps: [
      { id: 'intro', label: '导入问题', type: 'intro', title: '为什么规划完成后还要评价？', content: '评价不是事后打分，而是发现问题、补齐短板、推动整改和持续优化的机制。', question: '你认为一个村庄建设方案应该从哪些方面评价？', placeholder: '请写下你的初步判断……', storageKey: 'lesson07_intro' },
      { id: 'reading', label: 'PPT 阅读', type: 'reading', title: '课程 PPT 原文', guideTitle: '阅读提示', guidePoints: ['关注乡村建设评价的目的和原则', '关注评价体系和评价方法', '关注数据采集方式', '关注群众急难愁盼问题', '关注评价发现问题后的整改反馈'] },
      { id: 'evaluation_framework', label: '评价体系', type: 'task', title: '评价体系与评价方法', content: '乡村建设评价需要建立指标体系，并结合城乡比较、满意度分析、问题导向等方法。', relatedPages: 'PPT 第 5—36 页', checklist: ['已理解评价目的', '已理解评价原则', '已识别至少 3 类评价指标', '已判断哪些指标适合用于本平台方案评价'], placeholder: '请写下你认为最重要的评价指标……', storageKey: 'lesson07_evaluation_framework', mapTask: 'evaluation_framework' },
      { id: 'data_collection', label: '数据采集', type: 'task', title: '评价数据从哪里来？', content: '评价数据可来自指标填报、问卷调查、手机信令、遥感影像、村景照片、无人机影像和智能解译。', relatedPages: 'PPT 第 37—55 页', checklist: ['已识别一种传统数据来源', '已识别一种图像数据来源', '已识别一种村民感知数据来源', '已说明本平台已有数据如何用于评价'], placeholder: '请写下本平台可以采集哪些评价数据……', storageKey: 'lesson07_data_collection', mapTask: 'evaluation_data_collection' },
      { id: 'problem_evaluation', label: '问题评价', type: 'task', title: '识别群众急难愁盼和短板弱项', content: '评价要关注农房品质、污水垃圾、道路照明、公共服务和村庄风貌等群众感受强烈的问题。', relatedPages: 'PPT 第 57—70 页', checklist: ['已识别一个农房品质问题', '已识别一个污水垃圾或风貌问题', '已识别一个道路照明或出行问题', '已识别一个公共服务问题'], placeholder: '请写下本村最需要评价和改进的问题……', storageKey: 'lesson07_problem_evaluation', mapTask: 'problem_evaluation' },
      { id: 'feedback_improvement', label: '整改反馈', type: 'task', title: '从评价发现问题到推动整改', content: '评价结果应推动农房管理、污水垃圾治理、商贸服务、公共服务和养老服务等方面持续改善。', relatedPages: 'PPT 第 72—88 页', checklist: ['已选择一个评价发现的问题', '已提出整改措施', '已说明责任主体', '已说明如何跟踪成效'], placeholder: '请写下一个评价—整改—反馈的闭环方案……', storageKey: 'lesson07_feedback_improvement', mapTask: 'feedback_improvement' },
      { id: 'plan_assessment', label: '方案评价', type: 'task', title: '对小组方案进行一次评价', content: '请从空间合理性、实施可行性、村民满意度、生态影响、公共服务提升等方面评价小组方案。', relatedPages: '综合任务', checklist: ['已评价空间合理性', '已评价实施可行性', '已评价公共服务改善', '已评价村民感受或满意度', '已提出优化建议'], placeholder: '请写下你对当前小组方案的评价……', storageKey: 'lesson07_plan_assessment', mapTask: 'plan_assessment' },
      { id: 'reflection', label: '小结反思', type: 'reflection', title: '本讲反思', question: '乡村建设评价如何反过来改进规划和建设？', hint: '请结合数据采集、问题识别、整改反馈和持续优化回答。', placeholder: '请结合数据采集、问题识别、整改反馈和持续优化回答……', storageKey: 'lesson07_reflection' }
    ]
  }
];

function App() {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [showBackTop, setShowBackTop] = useState(false);
  const [selectedVillageId, setSelectedVillageId] = useState(DEFAULT_VILLAGE_ID);
  const [activeLessonId, setActiveLessonId] = useState<string | null>(null);
  const [currentLessonStep, setCurrentLessonStep] = useState('intro');
  const [lessonGuideOpen, setLessonGuideOpen] = useState(true);
  const [lessonInputs, setLessonInputs] = useState<Record<string, string>>({});
  const [lessonChecks, setLessonChecks] = useState<Record<string, boolean[]>>({});
  const [completedLessons, setCompletedLessons] = useState<Record<string, boolean>>({});
  const [visitedSteps, setVisitedSteps] = useState<string[]>([]);
  const [reflectionSaved, setReflectionSaved] = useState(false);
  const [pdfAvailable, setPdfAvailable] = useState(true);
  const [authState, setAuthState] = useState<{ isLoggedIn: boolean; displayName: string; username: string }>({
    isLoggedIn: false,
    displayName: '',
    username: ''
  });

  const activeLesson = lessons.find((lesson) => lesson.id === activeLessonId);
  const activeStep = activeLesson?.steps.find((step) => step.id === currentLessonStep) || activeLesson?.steps[0];
  const selectedVillage = getVillageById(selectedVillageId);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'village-auth-state') {
        setAuthState({
          isLoggedIn: event.data.payload?.isLoggedIn || false,
          displayName: event.data.payload?.name || '',
          username: event.data.payload?.studentId || ''
        });
      }
    };
    window.addEventListener('message', handleMessage);
    // 请求父页面发送当前登录状态
    window.parent.postMessage({ type: 'village-auth-request' }, '*');
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const requestAuth = useCallback((mode: 'login' | 'register' = 'login') => {
    window.parent.postMessage({ type: 'village-auth-request', mode }, '*');
  }, []);

  const requestLogout = useCallback(() => {
    window.parent.postMessage({ type: 'village-auth-logout' }, '*');
    setAuthState({
      isLoggedIn: false,
      displayName: '',
      username: ''
    });
  }, []);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 50);
      setShowBackTop(window.scrollY > 300);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const scrollToSection = (sectionId: string) => {
    const element = document.getElementById(sectionId);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth' });
    }
    setIsMobileMenuOpen(false);
  };

  useEffect(() => {
    const completionState = lessons.reduce<Record<string, boolean>>((acc, lesson) => {
      acc[lesson.id] = localStorage.getItem(`${lesson.id}_completed`) === 'true';
      return acc;
    }, {});
    setCompletedLessons(completionState);
  }, []);

  const loadLessonInput = (key: string) => localStorage.getItem(key) || '';

  const loadLessonChecks = (lessonId: string, stepId: string, checklistLength: number) => {
    const saved = localStorage.getItem(`${lessonId}_${stepId}_checks`);
    if (!saved) return Array(checklistLength).fill(false);
    try {
      const parsed = JSON.parse(saved);
      if (!Array.isArray(parsed)) return Array(checklistLength).fill(false);
      return Array.from({ length: checklistLength }, (_, index) => !!parsed[index]);
    } catch {
      return Array(checklistLength).fill(false);
    }
  };

  const openLessonModal = (lessonId: string) => {
    const lesson = lessons.find((item) => item.id === lessonId);
    if (!lesson) return;

    const stepIds = lesson.steps.map((step) => step.id);
    const savedStep = localStorage.getItem(`${lesson.id}_current_step`);
    const nextStep = savedStep && stepIds.includes(savedStep) ? savedStep : lesson.steps[0].id;
    const savedVisited = localStorage.getItem(`${lesson.id}_visited_steps`);
    let nextVisited = [nextStep];
    if (savedVisited) {
      try {
        const parsedVisited = JSON.parse(savedVisited);
        if (Array.isArray(parsedVisited)) nextVisited = parsedVisited.filter((item) => typeof item === 'string');
      } catch {
        nextVisited = [nextStep];
      }
    }
    const inputs = lesson.steps.reduce<Record<string, string>>((acc, step) => {
      if ('storageKey' in step) acc[step.storageKey] = loadLessonInput(step.storageKey);
      return acc;
    }, {});
    const checks = lesson.steps.reduce<Record<string, boolean[]>>((acc, step) => {
      if (step.type === 'task') acc[step.id] = loadLessonChecks(lesson.id, step.id, step.checklist.length);
      return acc;
    }, {});

    setActiveLessonId(lesson.id);
    setCurrentLessonStep(nextStep);
    setLessonGuideOpen(true);
    setVisitedSteps(Array.from(new Set([...nextVisited, nextStep])));
    setLessonInputs(inputs);
    setLessonChecks(checks);
    setReflectionSaved(false);
    setPdfAvailable(false);
  };

  const closeLessonModal = () => {
    setActiveLessonId(null);
  };

  const goToMapPractice = (fallbackMessage = '请进入互动平台，在地图中完成对应观察任务。') => {
    closeLessonModal();
    window.setTimeout(() => {
      const entryButton = document.querySelector<HTMLButtonElement>('.home-hero-primary-btn');
      if (entryButton) {
        entryButton.click();
        return;
      }
      alert(fallbackMessage);
    }, 80);
  };

  const setLessonStep = (stepId: string) => {
    if (!activeLesson) return;
    setCurrentLessonStep(stepId);
    localStorage.setItem(`${activeLesson.id}_current_step`, stepId);
    setVisitedSteps((current) => {
      const next = Array.from(new Set([...current, stepId]));
      localStorage.setItem(`${activeLesson.id}_visited_steps`, JSON.stringify(next));
      return next;
    });
    setReflectionSaved(false);
  };

  const saveLessonInput = (key: string, value: string) => {
    setLessonInputs((current) => ({ ...current, [key]: value }));
    localStorage.setItem(key, value);
    setReflectionSaved(false);
  };

  const saveTaskCheck = (step: TaskStep, index: number, checked: boolean) => {
    if (!activeLesson) return;
    setLessonChecks((current) => {
      const currentChecks = current[step.id] || Array(step.checklist.length).fill(false);
      const nextChecks = currentChecks.map((item, itemIndex) => (itemIndex === index ? checked : item));
      localStorage.setItem(`${activeLesson.id}_${step.id}_checks`, JSON.stringify(nextChecks));
      return { ...current, [step.id]: nextChecks };
    });
  };

  const saveReflection = (step: ReflectionStep) => {
    localStorage.setItem(step.storageKey, lessonInputs[step.storageKey] || '');
    setReflectionSaved(true);
    window.setTimeout(() => setReflectionSaved(false), 2200);
  };

  const completeLesson = () => {
    if (!activeLesson) return;
    localStorage.setItem(`${activeLesson.id}_completed`, 'true');
    setCompletedLessons((current) => ({ ...current, [activeLesson.id]: true }));
    setReflectionSaved(true);
    alert('你已完成本讲学习，可以进入互动平台开展实践。');
    closeLessonModal();
  };

  useEffect(() => {
    if (!activeLesson?.pdfPath) return;
    let cancelled = false;
    setPdfAvailable(false);

    fetch(activeLesson.pdfPath, { method: 'HEAD' })
      .then((response) => {
        if (!cancelled) setPdfAvailable(response.ok);
      })
      .catch(() => {
        if (!cancelled) setPdfAvailable(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeLesson?.pdfPath]);

  const getActiveStepIndex = () => activeLesson?.steps.findIndex((step) => step.id === currentLessonStep) ?? -1;
  const getPreviousStep = () => {
    const index = getActiveStepIndex();
    return activeLesson && index > 0 ? activeLesson.steps[index - 1] : null;
  };
  const getNextStep = () => {
    const index = getActiveStepIndex();
    return activeLesson && index >= 0 && index < activeLesson.steps.length - 1 ? activeLesson.steps[index + 1] : null;
  };

  const renderTaskStep = (step: TaskStep) => {
    const previousStep = getPreviousStep();
    const nextStep = getNextStep();
    const checks = lessonChecks[step.id] || Array(step.checklist.length).fill(false);

    return (
      <section className="lesson-task-panel">
        <article className="lesson-task-card">
          <div className="lesson-task-heading">
            <MessageSquareText className="w-5 h-5" />
            <h3>{step.title}</h3>
          </div>
          <p>{step.content}</p>
          <div className="lesson-task-note">相关 PPT 页码：{step.relatedPages}</div>
          <div className="lesson-task-checklist">
            <h4>任务清单</h4>
            {step.checklist.map((item, index) => (
              <label key={item}>
                <input
                  type="checkbox"
                  checked={!!checks[index]}
                  onChange={(event) => saveTaskCheck(step, index, event.target.checked)}
                />
                <span>{item}</span>
              </label>
            ))}
          </div>
          <textarea
            value={lessonInputs[step.storageKey] || ''}
            onChange={(event) => saveLessonInput(step.storageKey, event.target.value)}
            placeholder={step.placeholder}
          />
          <div className="lesson-task-actions">
            <Button
              type="button"
              className="lesson-practice-btn"
              data-lesson={activeLesson?.id}
              data-map-task={step.mapTask}
              onClick={() => goToMapPractice('请进入互动平台，在地图中完成对应观察任务。')}
            >
              去地图实践
              <ArrowRight className="w-4 h-4" />
            </Button>
            {previousStep && (
              <Button type="button" className="lesson-secondary-btn" onClick={() => setLessonStep(previousStep.id)}>
                上一步
              </Button>
            )}
            {nextStep && (
              <Button type="button" className="lesson-next-btn" onClick={() => setLessonStep(nextStep.id)}>
                下一步
                <ArrowRight className="w-4 h-4" />
              </Button>
            )}
          </div>
        </article>
      </section>
    );
  };

  const renderLessonStep = () => {
    if (!activeLesson || !activeStep) return null;

    if (activeStep.type === 'intro') {
      return (
        <section className="lesson-intro-panel">
          <article className="lesson-task-card lesson-intro-card">
            <div className="lesson-task-heading">
              <BookOpen className="w-5 h-5" />
              <h3>{activeStep.title}</h3>
            </div>
            <p>{activeStep.content}</p>
            <div className="lesson-task-note">{activeStep.question}</div>
            <textarea
              value={lessonInputs[activeStep.storageKey] || ''}
              onChange={(event) => saveLessonInput(activeStep.storageKey, event.target.value)}
              placeholder={activeStep.placeholder}
            />
            <div className="lesson-task-actions">
              <Button type="button" className="lesson-next-btn" onClick={() => {
                const nextStep = getNextStep();
                if (nextStep) setLessonStep(nextStep.id);
              }}>
                进入 PPT 阅读
                <ArrowRight className="w-4 h-4" />
              </Button>
            </div>
          </article>
        </section>
      );
    }

    if (activeStep.type === 'reading') {
      const nextStep = getNextStep();
      return (
        <section className={`lesson-reading-layout ${lessonGuideOpen ? '' : 'guide-collapsed'}`}>
          <main className="lesson-pdf-main">
            <div className="lesson-panel-title">
              <FileText className="w-5 h-5" />
              <h3>{activeStep.title}</h3>
            </div>
            <div className="lesson-pdf-frame">
              {pdfAvailable ? (
                <object data={activeLesson.pdfPath} type="application/pdf" aria-label={`${activeLesson.number}课程 PPT`}>
                  <iframe src={activeLesson.pdfPath} title={`${activeLesson.number}课程 PPT`} />
                </object>
              ) : (
                <div className="lesson-pdf-placeholder">
                  请将本讲 PDF 文件放置到 {activeLesson.displayPdfPath}
                </div>
              )}
            </div>
          </main>

          {lessonGuideOpen ? (
            <aside className="lesson-guide-drawer">
              <div className="lesson-guide-drawer-header">
                <h3>{activeStep.guideTitle}</h3>
                <button type="button" onClick={() => setLessonGuideOpen(false)}>收起导学</button>
              </div>
              <p>{activeLesson.number}请重点关注：</p>
              <ol>
                {activeStep.guidePoints.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ol>
              {nextStep && (
                <Button type="button" className="lesson-next-btn" onClick={() => setLessonStep(nextStep.id)}>
                  下一步
                  <ArrowRight className="w-4 h-4" />
                </Button>
              )}
            </aside>
          ) : (
            <button type="button" className="lesson-guide-float-btn" onClick={() => setLessonGuideOpen(true)}>
              导学提示
            </button>
          )}
        </section>
      );
    }

    if (activeStep.type === 'task') return renderTaskStep(activeStep);

    const reflectionStep = activeStep;
    return (
      <section className="lesson-reflection-panel">
        <div>
          <h3>{reflectionStep.title}</h3>
          <p>{reflectionStep.question}</p>
          <p>{reflectionStep.hint}</p>
        </div>
        <textarea
          id={`${activeLesson.id}-reflection`}
          value={lessonInputs[reflectionStep.storageKey] || ''}
          onChange={(event) => saveLessonInput(reflectionStep.storageKey, event.target.value)}
          placeholder={reflectionStep.placeholder}
        />
        <div className="lesson-reflection-actions">
          <Button type="button" className="lesson-save-btn" onClick={() => saveReflection(reflectionStep)}>
            保存反思
          </Button>
          <Button type="button" className="lesson-next-btn" onClick={completeLesson}>
            完成本讲
          </Button>
          <span className={`lesson-save-state ${reflectionSaved ? 'is-visible' : ''}`}>
            已保存本讲反思
          </span>
        </div>
      </section>
    );
  };

  return (
    <div className="min-h-screen bg-gradient-nature">
      {/* Navigation */}
      <nav 
        className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
          isScrolled 
            ? 'glass shadow-lg py-3' 
            : 'bg-transparent py-5'
        }`}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="relative flex items-center justify-between">
            {/* Logo */}
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-green-600 to-emerald-500 rounded-xl flex items-center justify-center shadow-lg">
                <Trees className="w-6 h-6 text-white" />
              </div>
              <span className={`text-xl font-bold transition-colors ${
                isScrolled ? 'text-gray-800' : 'text-white'
              }`}>
                村庄规划互动平台
              </span>
            </div>

            {/* Desktop Navigation */}
            <div className="home-nav-list hidden md:flex items-center justify-center gap-8">
              <button 
                onClick={() => scrollToSection('teaching-purpose')}
                className={`home-nav-link text-sm font-medium transition-colors hover:opacity-80 ${
                  isScrolled ? 'text-gray-700' : 'text-white/90'
                }`}
              >
                教学目的
              </button>
              <button 
                onClick={() => scrollToSection('theory-learning')}
                className={`home-nav-link text-sm font-medium transition-colors hover:opacity-80 ${
                  isScrolled ? 'text-gray-700' : 'text-white/90'
                }`}
              >
                理论学习
              </button>
              <button 
                onClick={() => scrollToSection('practice')}
                className={`home-nav-link text-sm font-medium transition-colors hover:opacity-80 ${
                  isScrolled ? 'text-gray-700' : 'text-white/90'
                }`}
              >
                开始实践
              </button>
            </div>

            {/* Auth Buttons */}
            <div className="hidden md:flex items-center gap-3">
              {authState.isLoggedIn ? (
                <>
                  <div className={`home-auth-pill flex items-center gap-2 px-3 py-1.5 rounded-full ${isScrolled ? 'home-auth-pill-scrolled' : 'home-auth-pill-hero'}`}>
                    <User className="w-4 h-4" />
                    <span className="text-sm font-medium">你好，{authState.displayName || authState.username}</span>
                  </div>
                  <Button
                    type="button"
                    data-home-logout-btn="1"
                    variant="ghost"
                    className={`home-logout-btn gap-2 rounded-full px-3 py-1.5 ${isScrolled ? 'home-logout-btn-scrolled' : 'home-logout-btn-hero'}`}
                    onClick={requestLogout}
                  >
                    <LogOut className="w-4 h-4" />
                    退出登录
                  </Button>
                </>
              ) : (
                <>
                  <Button 
                    variant="ghost" 
                    className={`gap-2 ${isScrolled ? 'text-gray-700 hover:text-gray-900' : 'text-white hover:text-white hover:bg-white/20'}`}
                    onClick={() => requestAuth('login')}
                  >
                    <User className="w-4 h-4" />
                    登录
                  </Button>
                  <Button 
                    className="gap-2 bg-white text-green-700 hover:bg-gray-100 shadow-md"
                    onClick={() => requestAuth('register')}
                  >
                    <UserPlus className="w-4 h-4" />
                    注册
                  </Button>
                </>
              )}
            </div>

            {/* Mobile Menu Button */}
            <button 
              className="md:hidden p-2"
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            >
              {isMobileMenuOpen ? (
                <X className={`w-6 h-6 ${isScrolled ? 'text-gray-800' : 'text-white'}`} />
              ) : (
                <Menu className={`w-6 h-6 ${isScrolled ? 'text-gray-800' : 'text-white'}`} />
              )}
            </button>
          </div>
        </div>

        {/* Mobile Menu */}
        {isMobileMenuOpen && (
          <div className="md:hidden glass mt-3 mx-4 rounded-2xl shadow-xl p-4 animate-slide-up">
            <div className="flex flex-col gap-3">
              <button 
                onClick={() => scrollToSection('teaching-purpose')}
                className="text-left px-4 py-3 rounded-xl hover:bg-green-50 text-gray-700 font-medium transition-colors"
              >
                教学目的
              </button>
              <button 
                onClick={() => scrollToSection('theory-learning')}
                className="text-left px-4 py-3 rounded-xl hover:bg-green-50 text-gray-700 font-medium transition-colors"
              >
                理论学习
              </button>
              <button 
                onClick={() => scrollToSection('practice')}
                className="text-left px-4 py-3 rounded-xl hover:bg-green-50 text-gray-700 font-medium transition-colors"
              >
                开始实践
              </button>
              <hr className="my-2" />
              {authState.isLoggedIn ? (
                <>
                  <div className="flex items-center justify-center gap-2 px-4 py-2 rounded-full bg-green-50 text-green-700">
                    <User className="w-4 h-4" />
                    <span className="text-sm font-medium">你好，{authState.displayName || authState.username}</span>
                  </div>
                  <Button variant="outline" data-home-logout-btn="1" className="w-full gap-2 justify-center" onClick={requestLogout}>
                    <LogOut className="w-4 h-4" />
                    退出登录
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="outline" className="w-full gap-2 justify-center" onClick={() => requestAuth('login')}>
                    <User className="w-4 h-4" />
                    登录
                  </Button>
                  <Button className="w-full gap-2 justify-center bg-green-600 hover:bg-green-700" onClick={() => requestAuth('register')}>
                    <UserPlus className="w-4 h-4" />
                    注册
                  </Button>
                </>
              )}
            </div>
          </div>
        )}
      </nav>

      {/* Hero Section */}
      <section className="relative min-h-screen flex items-center justify-center overflow-hidden">
        {/* Background Pattern */}
        <div className="absolute inset-0 bg-gradient-hero">
          <div className="absolute inset-0 opacity-10">
            <div className="absolute top-20 left-10 w-72 h-72 bg-white rounded-full blur-3xl" />
            <div className="absolute bottom-20 right-10 w-96 h-96 bg-emerald-300 rounded-full blur-3xl" />
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-green-400 rounded-full blur-3xl opacity-30" />
          </div>
          {/* Grid Pattern */}
          <div
            className="absolute inset-0 opacity-5"
            style={{
              backgroundImage: `linear-gradient(rgba(255,255,255,.3) 1px, transparent 1px),
                               linear-gradient(90deg, rgba(255,255,255,.3) 1px, transparent 1px)`,
              backgroundSize: '50px 50px'
            }}
          />
        </div>

        {/* Hero Content */}
        <div className="relative z-10 max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 text-center pt-20">
          <div className="animate-fade-in">
            {/* Badge */}
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/10 backdrop-blur-sm border border-white/20 mb-8">
              <Leaf className="w-4 h-4 text-emerald-300" />
              <span className="text-white/90 text-sm font-medium">智慧乡村 · 数字规划</span>
            </div>

            {/* Main Title */}
            <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold text-white mb-6 leading-tight">
              村庄规划
              <span className="block text-transparent bg-clip-text bg-gradient-to-r from-emerald-200 to-green-100">
                互动平台
              </span>
            </h1>

            {/* Subtitle */}
            <p className="text-lg sm:text-xl text-white/80 max-w-2xl mx-auto mb-10 leading-relaxed">
              运用数字化技术，打造沉浸式村庄规划体验。
              <br className="hidden sm:block" />
              让规划更直观，让参与更便捷，让乡村更美好。
            </p>

            {/* CTA Buttons */}
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Button 
                size="lg"
                className="home-hero-action-btn home-hero-primary-btn w-full sm:w-auto gap-3 text-lg px-8 py-6 rounded-xl font-semibold"
              >
                进入互动平台
                <ArrowRight className="w-5 h-5" />
              </Button>
              <Button 
                size="lg"
                className="home-hero-action-btn home-hero-secondary-btn home-hero-secondary-compact w-full sm:w-auto gap-3 text-lg px-8 py-6 rounded-xl font-semibold"
                onClick={() => scrollToSection('teaching-purpose')}
              >
                了解更多
                <ArrowRight className="w-5 h-5" />
              </Button>
            </div>
          </div>

          {/* Stats */}
          <div className="mt-16 grid grid-cols-2 md:grid-cols-4 gap-6 max-w-3xl mx-auto">
            {[
              { label: '规划村庄', value: '50+' },
              { label: '参与用户', value: '1000+' },
              { label: '规划方案', value: '200+' },
              { label: '覆盖面积', value: '5000亩' },
            ].map((stat, index) => (
              <div
                key={index} 
                className="text-center p-4 rounded-2xl bg-white/5 backdrop-blur-sm border border-white/10"
              >
                <div className="text-2xl sm:text-3xl font-bold text-white mb-1">{stat.value}</div>
                <div className="text-white/60 text-sm">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Scroll Indicator */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 animate-bounce">
          <div className="w-8 h-12 rounded-full border-2 border-white/30 flex items-start justify-center p-2">
            <div className="w-1.5 h-3 bg-white/60 rounded-full" />
          </div>
        </div>
      </section>

      {/* Teaching Purpose Section */}
      <section id="teaching-purpose" className="py-24 px-4 sm:px-6 lg:px-8 bg-white/50">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-blue-100 text-blue-700 mb-6">
              <GraduationCap className="w-4 h-4" />
              <span className="text-sm font-medium">教学目的</span>
            </div>
            <h2 className="text-3xl sm:text-4xl font-bold text-gray-800 mb-4">
              培养规划思维与实践能力
            </h2>
            <p className="text-gray-600 max-w-2xl mx-auto">
              通过互动式学习，让学生掌握村庄规划的基本方法和技能
            </p>
          </div>

          {/* Features Grid */}
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              { icon: BookOpen, title: '理论学习', desc: '村庄规划基础知识' },
              { icon: Map, title: '案例分析', desc: '典型村庄规划案例' },
              { icon: Compass, title: '实践操作', desc: '动手设计规划方案' },
              { icon: Trees, title: '创新思维', desc: '培养创新规划理念' },
            ].map((item, index) => (
              <div
                key={index}
                className="text-center p-6 rounded-2xl hover:bg-white hover:shadow-lg transition-all duration-300"
              >
                <div className="w-16 h-16 rounded-2xl bg-blue-100 flex items-center justify-center mx-auto mb-4">
                  <item.icon className="w-8 h-8 text-blue-600" />
                </div>
                <h3 className="text-lg font-semibold text-gray-800 mb-2">{item.title}</h3>
                <p className="text-gray-600 text-sm">{item.desc}</p>
              </div>
            ))}
          </div>

          {/* Content Placeholder */}
          <div className="mt-12 p-12 rounded-3xl bg-gradient-to-br from-blue-50 to-indigo-50 border-2 border-dashed border-blue-200 text-center">
            <div className="w-20 h-20 rounded-full bg-blue-100 flex items-center justify-center mx-auto mb-6">
              <GraduationCap className="w-10 h-10 text-blue-400" />
            </div>
            <h3 className="text-xl font-semibold text-gray-700 mb-2">教学目的内容区域</h3>
            <p className="text-gray-500 max-w-md mx-auto">
              此处预留教学目的的详细内容展示区域，可放置教学目标、课程大纲、学习路径等内容
            </p>
          </div>
        </div>
      </section>

      {/* Theory Learning Section */}
      <section id="theory-learning" className="theory-section py-24 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="theory-section-header text-center mb-12">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/16 text-white mb-6 border border-white/20">
              <BookOpen className="w-4 h-4" />
              <span className="text-sm font-medium">理论学习</span>
            </div>
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">
              村庄规划理论学习
            </h2>
            <p className="text-white/78 max-w-3xl mx-auto leading-relaxed">
              以课程 PPT 为基础，通过导学提示、关键问题与地图实践任务，帮助学生从理论理解走向空间认知。
            </p>
          </div>

          <div className="theory-grid">
            {lessons.map((lesson, index) => {
              const isCompleted = !!completedLessons[lesson.id];
              const hasStarted = !!localStorage.getItem(`${lesson.id}_current_step`);
              const buttonLabel = isCompleted ? '重新学习' : hasStarted ? '继续学习' : '开始学习';
              return (
                <article
                  key={lesson.id}
                  className={`theory-card theory-card-open ${isCompleted ? 'theory-card-completed' : ''}`}
                  onClick={() => openLessonModal(lesson.id)}
                >
                  <div className="theory-card-top">
                    <span className="theory-card-index">{String(index + 1).padStart(2, '0')}</span>
                    <span className={`theory-status ${isCompleted ? 'theory-status-completed' : 'theory-status-open'}`}>
                      {isCompleted ? <CheckCircle2 className="w-4 h-4" /> : <Clock className="w-4 h-4" />}
                      {isCompleted ? '已完成' : lesson.tag}
                    </span>
                  </div>
                  <div className="theory-card-subtitle">{lesson.shortTitle}</div>
                  <h3>{lesson.number} {lesson.title}</h3>
                  <p>{lesson.description}</p>
                  <Button
                    type="button"
                    className="theory-card-btn theory-card-btn-open"
                    onClick={(event) => {
                      event.stopPropagation();
                      openLessonModal(lesson.id);
                    }}
                  >
                    {buttonLabel}
                    <ArrowRight className="w-4 h-4" />
                  </Button>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      {/* Practice Section */}
      <section id="practice" className="py-24 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-12">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-green-100 text-green-700 mb-6">
              <Home className="w-4 h-4" />
              <span className="text-sm font-medium">开始实践</span>
            </div>
            <h2 className="text-3xl sm:text-4xl font-bold text-gray-800 mb-4">
              选择村庄，了解现状并识别问题
            </h2>
            <p className="text-gray-600 max-w-2xl mx-auto">
              村庄选择将同步更新地图、村庄现状与现状问题，为后续规划实践提供统一信息基础
            </p>
          </div>

          <VillageMapSection
            selectedVillageId={selectedVillageId}
            onVillageChange={setSelectedVillageId}
          />

          <div id="village-status" className="mt-20 scroll-mt-24">
            <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <div className="mb-3 inline-flex items-center gap-2 text-sm font-semibold text-green-700">
                  <MapPin className="h-4 w-4" />
                  村庄现状
                </div>
                <h3 className="text-2xl sm:text-3xl font-bold text-gray-800">{selectedVillage.name}现状概览</h3>
              </div>
              <p className="max-w-xl text-sm leading-6 text-gray-500">以下内容随上方村庄选择同步切换。</p>
            </div>
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              {selectedVillage.statusItems.map((item) => (
                <article key={item.title} className="group p-8 rounded-3xl bg-white/70 backdrop-blur-sm border border-green-100 hover:bg-white hover:shadow-xl transition-all duration-300">
                  <div className="w-14 h-14 rounded-2xl bg-green-100 flex items-center justify-center mb-6 group-hover:bg-green-600 transition-colors">
                    <MapPin className="w-7 h-7 text-green-600 group-hover:text-white transition-colors" />
                  </div>
                  <h4 className="text-xl font-semibold text-gray-800 mb-3">{item.title}</h4>
                  <p className="text-gray-600 leading-7">{item.desc}</p>
                </article>
              ))}
            </div>
          </div>

          <div id="current-issues" className="mt-20 scroll-mt-24">
            <div className="mb-8">
              <div className="mb-3 inline-flex items-center gap-2 text-sm font-semibold text-amber-700">
                <AlertTriangle className="h-4 w-4" />
                现状问题
              </div>
              <h3 className="text-2xl sm:text-3xl font-bold text-gray-800">{selectedVillage.name}发展问题识别</h3>
            </div>
            <div className="grid md:grid-cols-2 gap-6">
              {selectedVillage.issueItems.map((item) => (
                <article key={item.title} className="flex items-start gap-4 p-6 rounded-2xl bg-white/70 backdrop-blur-sm border border-amber-100 hover:shadow-lg transition-all">
                  <div className="w-12 h-12 rounded-xl bg-amber-100 flex items-center justify-center flex-shrink-0">
                    <AlertTriangle className="w-6 h-6 text-amber-600" />
                  </div>
                  <div>
                    <h4 className="text-lg font-semibold text-gray-800 mb-2">{item.title}</h4>
                    <p className="text-gray-600 leading-7">{item.desc}</p>
                  </div>
                </article>
              ))}
            </div>
          </div>

          <div className="relative mt-20 overflow-hidden rounded-3xl bg-gradient-hero p-12 sm:p-16 text-center">
            {/* Background Decoration */}
            <div className="absolute inset-0 opacity-10">
              <div className="absolute top-0 left-0 w-64 h-64 bg-white rounded-full blur-3xl -translate-x-1/2 -translate-y-1/2" />
              <div className="absolute bottom-0 right-0 w-64 h-64 bg-emerald-300 rounded-full blur-3xl translate-x-1/2 translate-y-1/2" />
            </div>

            <div className="relative z-10">
              <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">
                准备好开始规划了吗？
              </h2>
              <p className="text-white/80 text-lg mb-8 max-w-xl mx-auto">
                加入我们的互动平台，开启您的村庄规划之旅，共同打造美好乡村
              </p>
              <Button 
                size="lg"
                className="gap-3 bg-white text-green-700 hover:bg-gray-100 shadow-xl text-lg px-10 py-6 rounded-xl font-semibold"
              >
                立即进入平台
                <ArrowRight className="w-5 h-5" />
              </Button>
            </div>
          </div>
        </div>
      </section>

      {activeLesson && (
        <div className="lesson-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="lesson-modal-title">
          <div className="lesson-modal">
            <div className="lesson-modal-header">
              <div>
                <span className="lesson-modal-kicker">村庄规划理论学习</span>
                <h2 id="lesson-modal-title">{activeLesson.number}：{activeLesson.title}</h2>
              </div>
              <button type="button" className="lesson-close-btn" onClick={closeLessonModal} aria-label="关闭学习弹窗">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="lesson-stepper" aria-label={`${activeLesson.number}学习步骤`}>
              {activeLesson.steps.map((step, index) => {
                const currentIndex = activeLesson.steps.findIndex((item) => item.id === currentLessonStep);
                const isActive = step.id === currentLessonStep;
                const isCompleted = visitedSteps.includes(step.id) || index < currentIndex;
                return (
                  <button
                    type="button"
                    key={step.id}
                    className={`lesson-step ${isActive ? 'active' : ''} ${isCompleted ? 'completed' : ''}`}
                    onClick={() => setLessonStep(step.id)}
                  >
                    <span>{isCompleted ? <CheckCircle2 className="w-4 h-4" /> : index + 1}</span>
                    {step.label}
                  </button>
                );
              })}
            </div>

            <div className="lesson-step-content">
              {renderLessonStep()}
            </div>
          </div>
        </div>
      )}

      {/* Back to Top */}
      <button
        onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        className={`fixed bottom-8 right-8 z-50 w-12 h-12 rounded-full bg-white/90 backdrop-blur-sm border border-green-200 text-green-700 shadow-lg flex items-center justify-center transition-all duration-300 hover:bg-white hover:shadow-xl hover:-translate-y-1 ${showBackTop ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none'}`}
        aria-label="回到顶部"
      >
        <ArrowUp className="w-5 h-5" />
      </button>

      {/* Footer */}
      <footer className="py-12 px-4 sm:px-6 lg:px-8 bg-gray-900 text-white">
        <div className="max-w-7xl mx-auto">
          <div className="grid md:grid-cols-4 gap-8 mb-8">
            <div className="md:col-span-2">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 bg-gradient-to-br from-green-500 to-emerald-400 rounded-xl flex items-center justify-center">
                  <Trees className="w-6 h-6 text-white" />
                </div>
                <span className="text-xl font-bold">村庄规划互动平台</span>
              </div>
              <p className="text-gray-400 max-w-sm">
                致力于通过数字化技术，推动村庄规划的科学化、民主化、可视化发展
              </p>
            </div>
            <div>
              <h4 className="font-semibold mb-4">快速链接</h4>
              <ul className="space-y-2 text-gray-400">
                <li><button onClick={() => scrollToSection('teaching-purpose')} className="hover:text-white transition-colors">教学目的</button></li>
                <li><button onClick={() => scrollToSection('theory-learning')} className="hover:text-white transition-colors">理论学习</button></li>
                <li><button onClick={() => scrollToSection('practice')} className="hover:text-white transition-colors">开始实践</button></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-4">联系我们</h4>
              <ul className="space-y-2 text-gray-400">
                <li>邮箱：contact@village-planning.com</li>
                <li>电话：400-123-4567</li>
                <li>地址：某某省某某市某某区</li>
              </ul>
            </div>
          </div>
          <div className="pt-8 border-t border-gray-800 text-center text-gray-500 text-sm">
            © 2024 中国区域协调发展与乡村建设研究院. 保留所有权利.
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;
