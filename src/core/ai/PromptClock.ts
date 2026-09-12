/**
 * The calendar date as prompts state it. A model has a training cutoff and, told
 * nothing else, treats the last thing it saw as "now": asked for Apple's newest
 * phone it searches for the one it remembers, then reads last year's leaks back as
 * current news. Every prompt that can depend on what is current carries this line.
 */
const WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

export function describePromptDate(now: Date): string {
  if (Number.isNaN(now.getTime())) return '';
  return `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 ${WEEKDAYS[now.getDay()]}`;
}

export function describePromptDateTime(now: Date): string {
  const date = describePromptDate(now);
  if (!date) return '';
  return `${date} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}
