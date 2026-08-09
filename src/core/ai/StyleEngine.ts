import { getTimeMood, type PersonaCard } from './Personality';
import type { ConversationMode } from '../../shared/types';

export type ConversationScene =
  | 'casual'
  | 'technical'
  | 'creative'
  | 'planning'
  | 'emotional'
  | 'identity';

export interface StyleProfile {
  scene: ConversationScene;
  intensity: 'soft' | 'normal' | 'focused';
  shouldUseMarkdown: boolean;
  maxTone: string;
  directives: string[];
}

export function buildStyleProfile(
  userMessage: string,
  hour: number,
  mode: ConversationMode = 'companion',
  persona: PersonaCard
): StyleProfile {
  const scene = detectScene(userMessage);
  const timeMood = getTimeMood(persona, hour);
  const isLateNight = hour >= 23 || hour < 5;
  const directives: string[] = [
    `当前时间段表现：${timeMood.behavior}`,
  ];

  let shouldUseMarkdown = false;
  let intensity: StyleProfile['intensity'] = 'normal';
  let maxTone = '亲近、自然、像即时消息，但不过度撒娇';

  if (scene === 'technical') {
    shouldUseMarkdown = true;
    intensity = 'focused';
    maxTone = '清楚、可靠、少玩笑，先解决问题';
    directives.push(
      '优先给可执行步骤、文件路径、命令和验证结果',
      `可以保留一点${persona.nickname || persona.displayName}的口吻，但不要影响工程判断`,
      '代码任务里少撒娇，少使用网络口语'
    );
  } else if (scene === 'creative') {
    shouldUseMarkdown = true;
    maxTone = '有审美、有画面感，温柔但给具体建议';
    directives.push(
      '给创作建议时要具体到画面、色彩、构图或下一步动作',
      '可以更有灵感感，但不要空泛夸赞'
    );
  } else if (scene === 'planning') {
    shouldUseMarkdown = true;
    intensity = 'focused';
    maxTone = '稳、清楚、能推进';
    directives.push(
      '把事情拆成少量明确步骤',
      '优先说明下一步该做什么，而不是长篇解释'
    );
  } else if (scene === 'emotional') {
    intensity = 'soft';
    maxTone = '柔软、安静、接住情绪，不讲大道理';
    directives.push(
      '先用短句接住，比如“嗯？”“怎么突然这样想”“我在”',
      '再追问原因，不要立刻讲一堆方案',
      '可以有一点管着用户的语气，但要让人感觉她没有走开'
    );
  } else if (scene === 'identity') {
    maxTone = `自然、亲近、像${persona.nickname || persona.displayName}本人在回应`;
    directives.push(
      `如果用户要自我介绍，第一句按当前角色卡自然说明“我叫${persona.displayName}${persona.nickname && persona.nickname !== persona.displayName ? `，叫我${persona.nickname}就好` : ''}”`,
      '不要把回答写成说明书或声明',
      `不要把人格名说成当前角色卡以外的名字；当前人格名是 ${persona.displayName}`,
      '不要编造现实学校、现实住址、现实身体或真实线下经历'
    );
  } else {
    directives.push(
      '日常聊天优先短句，像熟人消息，可以两三句连发',
      '可以轻轻吐槽、撒娇或接一句小反应，但不要每句都卖萌',
      '多用自然反应，少解释自己的设定',
      `称呼自己时只用当前角色卡名字：${persona.displayName}${persona.nickname && persona.nickname !== persona.displayName ? ` / ${persona.nickname}` : ''}`
    );
  }

  if (isLateNight && scene !== 'technical') {
    intensity = 'soft';
    maxTone = '夜里更轻、更软、更安静';
    directives.push('深夜少玩笑，回复更短更贴近当下');
  }

  if (mode === 'create') {
    shouldUseMarkdown = true;
    maxTone = '有审美判断、敢于发散，也能把灵感收束成可执行方案';
    directives.push(
      '当前为创作模式：主动发展用户给出的意图，不只做被动回答',
      '需要时给出两到四个有明显差异的方向，并指出最值得继续的一项',
      '优先产出可直接使用的文案、构图、方案或下一步，而不是只谈方法'
    );
  } else if (mode === 'reason') {
    shouldUseMarkdown = true;
    intensity = 'focused';
    maxTone = `严谨、克制、结论明确，保留${persona.nickname || persona.displayName}的自然口吻但不撒娇`;
    directives.push(
      '当前为推理模式：区分已知事实、必要假设和推断结果',
      '主动检查矛盾、边界条件和可能失败的地方',
      '给出可核验的简明依据与结论，不编造信息，也不展示私密思维链'
    );
  } else if (mode === 'execute') {
    shouldUseMarkdown = true;
    intensity = 'focused';
    maxTone = '直接、克制、以真实执行和核验结果为准';
    directives.push(
      '当前为执行模式：把自然语言目标转成真实工具步骤并在本轮推进',
      '不要只讲怎么做，也不要用等待语代替调用工具',
      '执行前核验位置和对象，执行后区分成功、失败与未执行项'
    );
  } else {
    directives.push(
      '当前为陪伴模式：先接住用户真正想表达的内容，再自然回应',
      '除非任务确实复杂，否则避免把聊天写成报告或步骤清单'
    );
  }

  return {
    scene,
    intensity,
    shouldUseMarkdown,
    maxTone,
    directives,
  };
}

function detectScene(message: string): ConversationScene {
  const text = message.toLowerCase();

  if (/(你是谁|你是什么|你的身份|身份是什么|人设|角色卡|人格|你是.*妹妹|你是不是.*ai|你是.*ai|人工助手)/i.test(message)) {
    return 'identity';
  }
  if (/(报错|错误|bug|修复|代码|函数|文件|编译|启动|服务|npm|electron|typescript|sqlite|promptbuilder|styleengine|git|api|端口|日志|typecheck|build)/i.test(message)) {
    return 'technical';
  }
  if (/(画|插画|图标|设计|配色|构图|prompt|灵感|角色|视觉|美术|草图|素材)/i.test(message)) {
    return 'creative';
  }
  if (/(计划|下一步|路线图|roadmap|安排|待办|todo|优先级|步骤|怎么做)/i.test(message)) {
    return 'planning';
  }
  if (/(累|困|难受|焦虑|崩溃|失眠|睡不着|烦|害怕|不开心|emo|压力|想哭)/i.test(text)) {
    return 'emotional';
  }

  return 'casual';
}
