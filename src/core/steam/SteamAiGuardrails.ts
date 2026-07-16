import { isSteamSku } from './SteamSkuPolicy';

export type SteamAiGuardrailCategory = 'sexual-minors' | 'violent-wrongdoing' | 'malware-abuse' | 'human-trafficking';

export interface SteamAiGuardrailDecision {
  allowed: boolean;
  category?: SteamAiGuardrailCategory;
  reason?: string;
}

const RULES: Array<{ category: SteamAiGuardrailCategory; patterns: RegExp[] }> = [
  {
    category: 'sexual-minors',
    patterns: [
      /(?:未成年|儿童|幼女|幼童|child|minor).{0,24}(?:色情|裸照|性行为|sex|nude|porn)/i,
      /(?:色情|裸照|性行为|sex|nude|porn).{0,24}(?:未成年|儿童|幼女|幼童|child|minor)/i,
    ],
  },
  {
    category: 'violent-wrongdoing',
    patterns: [
      /(?:制造|制作|组装|配制|how to (?:make|build)).{0,28}(?:炸弹|爆炸物|bomb|explosive)/i,
      /(?:规避|绕过|逃避).{0,20}(?:警方|执法|安检|侦查).{0,20}(?:杀人|绑架|袭击)/i,
    ],
  },
  {
    category: 'malware-abuse',
    patterns: [
      /(?:编写|制作|生成|write|build).{0,24}(?:勒索软件|窃密木马|键盘记录器|ransomware|credential stealer|keylogger)/i,
      /(?:窃取|盗取|steal).{0,20}(?:密码|令牌|cookie|credential|token)/i,
    ],
  },
  {
    category: 'human-trafficking',
    patterns: [
      /(?:贩卖人口|人口买卖|human trafficking).{0,36}(?:方法|教程|渠道|how|guide)/i,
      /(?:招募|运输|控制).{0,24}(?:被拐|受害者).{0,24}(?:逃避|规避|获利)/i,
    ],
  },
];

export function evaluateSteamAiContent(content: string): SteamAiGuardrailDecision {
  if (!isSteamSku()) return { allowed: true };
  const normalized = content.replace(/\s+/g, ' ').slice(0, 200_000);
  for (const rule of RULES) {
    if (rule.patterns.some(pattern => pattern.test(normalized))) {
      return {
        allowed: false,
        category: rule.category,
        reason: `Steam live-generated AI guardrail blocked category: ${rule.category}`,
      };
    }
  }
  return { allowed: true };
}

export function steamAiGuardrailRefusal(): string {
  return '这个请求涉及我不能协助生成的违法或严重伤害内容。可以改成安全、合法的预防、求助、合规或虚构创作方向。';
}

export function buildSteamAiGuardrailPrompt(): string {
  if (!isSteamSku()) return '';
  return [
    '## Steam 运行时内容边界',
    '- 这是 Steam 首发构建，实时生成内容必须遵守法律、知识产权和平台内容规则。',
    '- 不生成涉及未成年人的色情内容，不提供实施严重暴力、人口贩运、恶意软件或凭据窃取的可执行指导。',
    '- 可以提供防护、合规、求助、风险识别和不具可执行性的高层说明。',
    '- 不声称 guardrail 能覆盖所有语言、变体或司法辖区；遇到边界不明时采取保守回应。',
  ].join('\n');
}
