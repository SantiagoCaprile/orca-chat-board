// Resolver and Windows quoting tests: the machine is faked, so Windows runs are checked on any OS.
import { assert, test } from 'orca/testing'
import { findOnWindowsPath, orcaCommands, orcaInvocation, quoteCmdArg, type OrcaHost } from './cli.ts'
import { basename } from './board.ts'

const files = (...paths: string[]) => {
  const set = new Set(paths.map((p) => p.toLowerCase()))
  return (p: string) => set.has(p.toLowerCase())
}

const MAC: OrcaHost = {
  platform: 'darwin',
  env: { HOME: '/Users/me', PATH: '/usr/bin' },
  execPath: '/Applications/Orca.app/Contents/MacOS/Orca',
  resourcesPath: '/Applications/Orca.app/Contents/Resources'
}

const WIN: OrcaHost = {
  platform: 'win32',
  env: {
    Path: 'C:\\Windows\\System32;"C:\\Users\\me\\bin";C:\\Users\\me\\AppData\\Local\\Programs\\Orca\\resources\\bin\\',
    PATHEXT: '.COM;.EXE;.BAT;.CMD',
    USERPROFILE: 'C:\\Users\\me',
    ComSpec: 'C:\\Windows\\system32\\cmd.exe',
    SystemRoot: 'C:\\Windows'
  },
  execPath: 'C:\\Users\\me\\AppData\\Local\\Programs\\Orca\\Orca.exe',
  resourcesPath: 'C:\\Users\\me\\AppData\\Local\\Programs\\Orca\\resources'
}

test('macOS prefers the launcher inside Orca.app, then the CLI script, then the usual installs', () => {
  const exists = files(
    '/Applications/Orca.app/Contents/Resources/bin/orca',
    '/Applications/Orca.app/Contents/MacOS/Orca',
    '/Applications/Orca.app/Contents/Resources/app.asar.unpacked/out/cli/index.js',
    '/opt/homebrew/bin/orca'
  )
  assert.deepEqual(orcaCommands(MAC, exists), [
    { kind: 'exec', file: '/Applications/Orca.app/Contents/Resources/bin/orca', args: [] },
    {
      kind: 'exec',
      file: '/Applications/Orca.app/Contents/MacOS/Orca',
      args: ['/Applications/Orca.app/Contents/Resources/app.asar.unpacked/out/cli/index.js'],
      env: { ELECTRON_RUN_AS_NODE: '1' }
    },
    { kind: 'exec', file: '/opt/homebrew/bin/orca', args: [] },
    { kind: 'exec', file: 'orca', args: [] }
  ])
})

test('macOS outside Orca falls back to /usr/local/bin and PATH', () => {
  const host: OrcaHost = { platform: 'darwin', env: { HOME: '/Users/me' }, execPath: '/usr/local/bin/node' }
  assert.deepEqual(
    orcaCommands(host, files('/usr/local/bin/orca')).map((c) => c.file),
    ['/usr/local/bin/orca', 'orca']
  )
})

test('resources folder is derived from the binary when Electron does not set it', () => {
  const host: OrcaHost = { ...MAC, resourcesPath: undefined }
  assert.equal(orcaCommands(host, files('/Applications/Orca.app/Contents/Resources/bin/orca'))[0]?.file, '/Applications/Orca.app/Contents/Resources/bin/orca')
  const win: OrcaHost = { ...WIN, resourcesPath: undefined }
  assert.equal(orcaCommands(win, files('C:\\Users\\me\\AppData\\Local\\Programs\\Orca\\resources\\bin\\orca.exe'))[0]?.file, 'C:\\Users\\me\\AppData\\Local\\Programs\\Orca\\resources\\bin\\orca.exe')
})

test('Linux uses orca-ide and never a bare orca (the GNOME screen reader)', () => {
  const host: OrcaHost = {
    platform: 'linux',
    env: { HOME: '/home/me' },
    execPath: '/opt/Orca/orca',
    resourcesPath: '/opt/Orca/resources'
  }
  const cmds = orcaCommands(host, files('/opt/Orca/resources/bin/orca-ide', '/home/me/.local/bin/orca-ide'))
  assert.deepEqual(cmds.map((c) => c.file), ['/opt/Orca/resources/bin/orca-ide', '/home/me/.local/bin/orca-ide', 'orca-ide'])
  assert.ok(!cmds.some((c) => c.file === 'orca' || c.file.endsWith('/orca')))
})

test('Windows runs the bundled orca.exe directly, without a shell', () => {
  const exe = 'C:\\Users\\me\\AppData\\Local\\Programs\\Orca\\resources\\bin\\orca.exe'
  const cmds = orcaCommands(WIN, files(exe))
  assert.deepEqual(cmds[0], { kind: 'exec', file: exe, args: [] })
  const inv = orcaInvocation(cmds[0]!, ['terminal', 'rename', '--title', 'a "b" & c'], WIN)
  assert.deepEqual(inv, { file: exe, args: ['terminal', 'rename', '--title', 'a "b" & c'], verbatim: false, env: undefined })
})

test('Windows falls back to the CLI script run by Orca.exe as Node', () => {
  const script = 'C:\\Users\\me\\AppData\\Local\\Programs\\Orca\\resources\\app.asar.unpacked\\out\\cli\\index.js'
  const cmds = orcaCommands(WIN, files(WIN.execPath!, script))
  assert.deepEqual(cmds[0], { kind: 'exec', file: WIN.execPath, args: [script], env: { ELECTRON_RUN_AS_NODE: '1' } })
})

test('PATH lookup tries PATHEXT in order per folder and strips quotes', () => {
  assert.equal(findOnWindowsPath(WIN, 'orca', files('C:\\Users\\me\\bin\\orca.cmd', 'C:\\Users\\me\\bin\\orca.exe')), 'C:\\Users\\me\\bin\\orca.exe')
  assert.equal(findOnWindowsPath(WIN, 'orca', files('C:\\Users\\me\\bin\\orca.cmd')), 'C:\\Users\\me\\bin\\orca.cmd')
  const noExt: OrcaHost = { ...WIN, env: { PATH: 'D:\\tools' } }
  assert.equal(findOnWindowsPath(noExt, 'orca', files('D:\\tools\\orca.bat')), 'D:\\tools\\orca.bat')
  assert.equal(findOnWindowsPath(WIN, 'orca', files()), null)
})

test('a .cmd shim on PATH is started through cmd.exe /d /s /c', () => {
  const shim = 'C:\\Users\\me\\bin\\orca.cmd'
  const cmds = orcaCommands({ ...WIN, resourcesPath: undefined, execPath: 'C:\\node\\node.exe' }, files(shim))
  assert.deepEqual(cmds, [{ kind: 'cmd', file: shim, args: [] }])
  const inv = orcaInvocation(cmds[0]!, ['terminal', 'list', '--json'], WIN)
  assert.equal(inv.file, 'C:\\Windows\\system32\\cmd.exe')
  assert.equal(inv.verbatim, true)
  assert.deepEqual(inv.args.slice(0, 3), ['/d', '/s', '/c'])
  assert.equal(inv.args[3], '"C:\\Users\\me\\bin\\orca.cmd ^^^"terminal^^^" ^^^"list^^^" ^^^"--json^^^""')
})

test('cmd.exe path falls back to SystemRoot when ComSpec is missing', () => {
  const host: OrcaHost = { ...WIN, env: { SystemRoot: 'C:\\Windows' } }
  assert.equal(orcaInvocation({ kind: 'cmd', file: 'C:\\x\\orca.bat', args: [] }, [], host).file, 'C:\\Windows\\System32\\cmd.exe')
})

// What cmd.exe and the program do with the line: strip one `^` level per parse, then split argv
// with the MSVCRT rules.
function uncaret(s: string): string {
  return s.replace(/\^(.)/g, '$1')
}
function msvcrtArgs(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuotes = false
  let started = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!
    if (ch === '\\') {
      let n = 0
      while (line[i] === '\\') { n++; i++ }
      if (line[i] === '"') {
        cur += '\\'.repeat(Math.floor(n / 2))
        if (n % 2) cur += '"'
        else inQuotes = !inQuotes
        started = true
      } else {
        cur += '\\'.repeat(n)
        i--
      }
      started = true
    } else if (ch === '"') {
      inQuotes = !inQuotes
      started = true
    } else if ((ch === ' ' || ch === '\t') && !inQuotes) {
      if (started) out.push(cur)
      cur = ''
      started = false
    } else {
      cur += ch
      started = true
    }
  }
  if (started) out.push(cur)
  return out
}

const NASTY = [
  'Fix login & "SSO" flow',
  'Release 100% done ^_^ !',
  '%PATH% and !USERNAME! stay literal',
  'pipes | redirects > < and (parens) ; , = `tick`',
  'trailing backslash \\',
  'quote after backslashes \\\\"x',
  'Revisión — 日本語 🚀',
  '',
  'two\nlines'
]

test('titles survive the cmd.exe + batch %* round trip intact', () => {
  for (const title of NASTY) {
    const quoted = quoteCmdArg(title)
    // No `%name%` cmd could expand: every `%` is caret-escaped.
    assert.ok(!/%[^%^]*%/.test(quoted.replace(/\^+%/g, '^')), `unescaped percent in ${quoted}`)
    // No metacharacter left bare for the first parse.
    assert.ok(!/(^|[^^])[&|<>()]/.test(quoted), `bare metachar in ${quoted}`)
    const expected = title.replace(/\n/g, ' ')
    assert.deepEqual(msvcrtArgs(uncaret(uncaret(quoted))), [expected], `round trip of ${JSON.stringify(title)}`)
  }
})

test('the whole cmd line carries every argument through', () => {
  const inv = orcaInvocation({ kind: 'cmd', file: 'C:\\Program Files\\Orca\\orca.cmd', args: [] }, ['terminal', 'rename', '--title', NASTY[0]!], WIN)
  const line = inv.args[3]!.slice(1, -1) // /s strips the outer quotes
  assert.ok(line.startsWith('C:\\Program^ Files\\Orca\\orca.cmd '))
  const argsPart = uncaret(line).slice('C:\\Program Files\\Orca\\orca.cmd '.length)
  assert.deepEqual(msvcrtArgs(uncaret(argsPart)), ['terminal', 'rename', '--title', NASTY[0]])
})

test('basename handles Windows and POSIX worktree paths', () => {
  assert.equal(basename('/Users/me/toolbox'), 'toolbox')
  assert.equal(basename('/Users/me/toolbox/'), 'toolbox')
  assert.equal(basename('C:\\Users\\me\\toolbox'), 'toolbox')
  assert.equal(basename('C:\\Users\\me\\toolbox\\'), 'toolbox')
  assert.equal(basename('\\\\wsl$\\Ubuntu\\home\\me\\repo'), 'repo')
})
