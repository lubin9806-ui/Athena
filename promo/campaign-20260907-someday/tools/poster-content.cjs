// Campaign "总有一天 / SOMEDAY" — the nine finished posters.
//
// Poster copy is either the user's poem (art plates) or a factual product claim
// that must be visible in the unmodified runtime capture it sits next to.
// Do not write a caption here that the screenshot does not actually show.
//
// tone: on art posters it describes the plate ('dark' plate -> light type);
// on product posters it is the poster field itself. The five daylight captures
// sit on a slate field so the bright app window is the light in the frame; the
// night capture inverts onto pale paper and closes the set against 03.

const campaign = {
  title: '总有一天',
  latin: 'SOMEDAY',
  brand: 'ATHENA · 苏时夏',
  tagline: '本地优先的桌面 AI 伙伴',
  build: 'DESKTOP 0.9.7-BETA.1 · 私有测试',
};

const posters = [
  {
    id: '01-clouds',
    kind: 'art',
    tone: 'dark',
    index: '01',
    art: 'clouds.png',
    kicker: '总有一天 · SOMEDAY',
    headline: ['总有一天，我们一同', '望向云端之上'],
    sub: '飞翔着坠入另一面。',
    note: '',
  },
  {
    id: '02-moon',
    kind: 'art',
    tone: 'dark',
    index: '02',
    art: 'moon.png',
    kicker: '第二章 · 夜与高山',
    headline: ['等到巨石推过高山'],
    sub: '一刻也不曾停止，银白色闪烁着胜利的星。',
    note: '夜里总是寸步难行，时常有蛇鼠蚊虫，野狼和猛虎。',
  },
  {
    id: '03-snow',
    kind: 'art',
    tone: 'light',
    index: '03',
    art: 'snow.png',
    kicker: '第三章 · 归途',
    headline: ['埋藏的第二天', '是他的归途'],
    sub: '也许不会迎来赤红，旅者长眠于风雪。',
    note: '',
  },
  {
    id: '04-companion',
    kind: 'product',
    tone: 'dark',
    index: '04',
    shot: '04-companion-day.png',
    kicker: '我们一同',
    headline: '陪伴，不只是回答',
    sub: '陪伴模式下先把话听完，再谈手头的事。',
    facts: [
      ['模式', '陪伴 · 自然地聊'],
      ['开场', '今天想先做什么？'],
      ['入口', '临时聊天，关闭即清除'],
    ],
  },
  {
    id: '05-create',
    kind: 'product',
    tone: 'dark',
    index: '05',
    shot: '05-create-day.png',
    kicker: '飞翔着坠入另一面',
    headline: '创作，从一句模糊的想法开始',
    sub: '描述想做的画面、文字或方案，它把这句话推成初稿。',
    facts: [
      ['模式', '创作 · 开放创作'],
      ['起手', '搭框架 / 扩方向 / 写初稿'],
      ['组织', 'Project 与对话分栏收纳'],
    ],
  },
  {
    id: '06-reason',
    kind: 'product',
    tone: 'dark',
    index: '06',
    shot: '06-reason-day.png',
    kicker: '夜里总是寸步难行',
    headline: '推理，是把话拆开再验一遍',
    sub: '把问题、条件和目标交给它，先核验，再下判断。',
    facts: [
      ['模式', '推理 · 核验后判断'],
      ['动作', '拆解假设 / 比较方案 / 查矛盾'],
      ['边界', '推理模式不碰电脑'],
    ],
  },
  {
    id: '07-execute',
    kind: 'product',
    tone: 'dark',
    index: '07',
    shot: '07-execution-day.png',
    kicker: '等到巨石推过高山',
    headline: '执行，是真的动手',
    sub: '四个模式里，只有执行能触碰这台电脑，而它默认是关着的。',
    facts: [
      ['权限', '执行权限 · 默认关闭'],
      ['工作区', 'Project 目录与项目目标'],
      ['扩展', 'Agent Skills 与 MCP Server'],
    ],
  },
  {
    id: '08-memory',
    kind: 'product',
    tone: 'dark',
    index: '08',
    shot: '08-memory-day.png',
    kicker: '埋藏的第二天',
    headline: '记住昨天，继续今天',
    sub: '长期记忆可查看、可检索、可导入；临时对话不写进去。',
    facts: [
      ['面板', '窗口 / 待确认 / 记忆 / 检索 / 导入'],
      ['临时聊天', '不写入长期记忆'],
      ['存放', '本地 SQLite，随时可查'],
    ],
  },
  {
    id: '09-night',
    kind: 'product',
    tone: 'pale',
    index: '09',
    shot: '09-companion-night.png',
    kicker: '银白色闪烁着胜利的星',
    headline: '夜里也亮着',
    sub: '同一套能力换上深色，陪你把这一天收尾。',
    facts: [
      ['界面', '深色主题，同一套模式'],
      ['时间', '一刻也不曾停止'],
      ['归属', '模型与记忆都在你自己的机器上'],
    ],
  },
];

// Short names used on the contact sheet, where a full headline would not fit.
const labels = {
  '01-clouds': '云端之上',
  '02-moon': '巨石与月',
  '03-snow': '归途',
  '04-companion': '陪伴',
  '05-create': '创作',
  '06-reason': '推理',
  '07-execute': '执行',
  '08-memory': '记忆',
  '09-night': '夜',
};

module.exports = { campaign, posters, labels };
