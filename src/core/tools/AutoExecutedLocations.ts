import * as path from 'path';

/**
 * Places where a file runs without anyone choosing to run it: at sign-in, when a
 * shell starts, when git acts on a repository, or when a shortcut someone trusts
 * is opened.
 *
 * Writing there is equivalent to executing code. The Files tier cannot run a
 * command, yet appending one line to the Startup folder or a PowerShell profile
 * used to go through without approval - a command that runs at the next sign-in
 * instead of now (ATH-SEC-010). This is a closed list of operating-system and
 * tool conventions, not a guess about what a file contains.
 */
export function describeAutoExecutedLocation(absolutePath: string): string | null {
  const normalized = path.normalize(absolutePath);
  const lower = normalized.toLowerCase();
  const segments = lower.split(/[\\/]+/).filter(Boolean);
  const base = segments[segments.length - 1] || '';
  const parent = segments[segments.length - 2] || '';
  const contains = (...sequence: string[]) => segments.some((_, index) => (
    sequence.every((segment, offset) => segments[index + offset] === segment)
  ));

  if (contains('start menu', 'programs', 'startup')) return '开机/登录时自动运行的启动文件夹';
  if (contains('windows', 'system32', 'tasks') || contains('windows', 'tasks')) return 'Windows 计划任务目录';
  if (contains('grouppolicy') && (segments.includes('scripts') || /^(startup|shutdown|logon|logoff)$/.test(parent))) {
    return '组策略启动/登录脚本目录';
  }
  if (/profile\.ps1$/.test(base) && /^(windowspowershell|powershell|v1\.0|7|7-preview)$/.test(parent)) {
    return 'PowerShell 配置文件（每次打开 PowerShell 都会执行）';
  }
  if (['.bashrc', '.bash_profile', '.bash_login', '.profile', '.zshrc', '.zprofile', '.zshenv', '.zlogin'].includes(base)) {
    return 'Shell 启动脚本（每次打开终端都会执行）';
  }
  if (base === '.gitconfig' || (parent === '.git' && base === 'config')) return 'git 配置（可以让 git 在操作时运行任意命令）';
  if (contains('.git', 'hooks')) return 'git hooks（git 操作时自动运行）';
  if (/\.(lnk|url|scf)$/.test(base)) return '快捷方式（打开时会运行它指向的程序）';
  if (base === 'autorun.inf') return '自动播放配置';
  return null;
}
