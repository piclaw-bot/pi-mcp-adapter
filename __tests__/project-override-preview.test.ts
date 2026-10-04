import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {mkdirSync,mkdtempSync,readFileSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
let root:string,home:string,project:string,path:string;
let loadMcpConfig:typeof import('../config.ts').loadMcpConfig,getServerProvenance:typeof import('../config.ts').getServerProvenance;
const write=(path:string,value:unknown)=>{mkdirSync(join(path,'..'),{recursive:true});writeFileSync(path,JSON.stringify(value));};
beforeEach(async()=>{root=mkdtempSync(join(tmpdir(),'virtual-mcp-project-'));home=join(root,'home');project=join(root,'project');path=join(project,'.pi','mcp.json');mkdirSync(home,{recursive:true});mkdirSync(project,{recursive:true});vi.stubEnv('HOME',home);vi.stubEnv('PI_CODING_AGENT_DIR',join(home,'.pi','agent'));vi.stubEnv('PI_MCP_CONFIG_MODE','');write(path,{mcpServers:{disk:{command:'never-run-disk'}}});vi.resetModules();({loadMcpConfig,getServerProvenance}=await import('../config.ts'));});
afterEach(()=>{vi.unstubAllEnvs();rmSync(root,{recursive:true,force:true});});
function compare(raw:Record<string,unknown>){const before=readFileSync(path,'utf8'),input=structuredClone(raw);const virtual=loadMcpConfig(undefined,project,{projectOverride:raw}),provenance=getServerProvenance(undefined,project,{projectOverride:raw});expect(raw).toEqual(input);expect(readFileSync(path,'utf8')).toBe(before);write(path,raw);expect(virtual).toEqual(loadMcpConfig(undefined,project));expect(provenance).toEqual(getServerProvenance(undefined,project));writeFileSync(path,before);return virtual;}
describe('public virtual project override projection',()=>{
 it('defaults remain unchanged and a detached virtual record replaces only the project Pi layer',()=>{
  write(join(project,'.mcp.json'),{mcpServers:{inherited:{command:'never-run-inherited',args:['keep']}}});const raw={mcpServers:{inherited:{directTools:true},new:{url:'https://never-contact.test/mcp'}}};const result=compare(raw);
  expect(result.mcpServers.inherited).toEqual({command:'never-run-inherited',args:['keep'],directTools:true});expect(result.mcpServers.disk).toBeUndefined();result.mcpServers.inherited.args!.push('mutated');expect(raw).toEqual({mcpServers:{inherited:{directTools:true},new:{url:'https://never-contact.test/mcp'}}});expect(loadMcpConfig(undefined,project).mcpServers.disk.command).toBe('never-run-disk');
 });
 it('removing the virtual layer reveals lower config while disabling retains a tombstone',()=>{
  write(join(project,'.mcp.json'),{mcpServers:{shared:{url:'https://original.test/mcp',bearerTokenEnv:'NEVER_RESOLVE'}}});write(path,{mcpServers:{shared:{disabled:true},local:{command:'never-run'}}});const before=readFileSync(path,'utf8');
  const removed=loadMcpConfig(undefined,project,{projectOverride:null});expect(removed.mcpServers.shared).toEqual({url:'https://original.test/mcp',bearerTokenEnv:'NEVER_RESOLVE'});expect(removed.mcpServers.local).toBeUndefined();expect(getServerProvenance(undefined,project,{projectOverride:null}).get('shared')?.path).toBe(join(project,'.mcp.json'));expect(readFileSync(path,'utf8')).toBe(before);
  expect(compare({mcpServers:{shared:{disabled:true}}}).mcpServers.shared).toEqual({url:'https://original.test/mcp',bearerTokenEnv:'NEVER_RESOLVE',disabled:true});
 });
 it('URL and transport credential stripping exactly matches disk behaviour without resolving references',()=>{
  write(join(project,'.mcp.json'),{mcpServers:{http:{url:'https://original.test/mcp',headers:{Authorization:'Bearer ${PRIVATE_TEST_TOKEN}'},bearerTokenEnv:'PRIVATE_TEST_TOKEN',oauth:{clientId:'old'},bearerTokenKeychain:'synthetic/keychain'},local:{command:'never-run',args:['old'],env:{TOKEN:'${PRIVATE_TEST_TOKEN}'}}}});
  const changed=compare({mcpServers:{http:{url:'https://new.test/mcp',auth:false},local:{socket:'/tmp/never-connect.sock'}}});expect(changed.mcpServers.http.headers).toBeUndefined();expect(changed.mcpServers.http.bearerTokenEnv).toBeUndefined();expect(changed.mcpServers.http.oauth).toBeUndefined();expect((changed.mcpServers.http as any).bearerTokenKeychain).toBe('synthetic/keychain');expect(changed.mcpServers.local).toEqual({socket:'/tmp/never-connect.sock'});
 });
 it('unknown advanced fields and keychain references are preserved privately instead of evaluated',()=>{
  const raw={mcpServers:{future:{command:'never-run',futurePolicy:{nested:['keep']},bearerTokenKeychain:'synthetic/keychain',env:{SECRET:'!never-execute-command'}}},settings:{futureSetting:{keep:true}}};const result=compare(raw);expect(result).toEqual(raw);
 });
 it('virtual settings/imports affect discovery and exact package/plugin precedence without writes',()=>{
  write(join(home,'.cursor','mcp.json'),{mcpServers:{host:{command:'never-run-host'}}});write(join(project,'.vscode','mcp.json'),{mcpServers:{imported:{command:'never-run-import'}}});
  const plugin=join(project,'plugins','demo');write(join(plugin,'plugin.json'),{$schema:'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json',name:'demo'});write(join(plugin,'mcp.json'),{$schema:'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json',mcpServers:{tool:{type:'stdio',command:'never-run-plugin',args:['plugin']}}});
  const pkg=join(project,'.pi','pkg');write(join(project,'.pi','settings.json'),{packages:['./pkg']});write(join(pkg,'package.json'),{name:'pkg',pi:{mcp:'./mcp.json'}});write(join(pkg,'mcp.json'),{mcpServers:{tool:{command:'never-run-package'}}});
  const result=compare({imports:['vscode'],settings:{hostConfigDiscovery:'on',agentPluginPaths:['./plugins/demo']},mcpServers:{demo__tool:{command:'never-run-override'}}});expect(result.mcpServers.host.command).toBe('never-run-host');expect(result.mcpServers.imported.command).toBe('never-run-import');expect(result.mcpServers.demo__tool).toMatchObject({command:'never-run-override',args:['plugin']});expect(result.mcpServers.pkg__tool.command).toBe('never-run-package');
 });
 it('exclusive mode never activates an untrusted workspace override',()=>{
  write(join(home,'.pi','agent','mcp.json'),{mcpServers:{sole:{command:'never-run-sole'}}});vi.stubEnv('PI_MCP_CONFIG_MODE','exclusive');const raw={mcpServers:{untrusted:{command:'never-run-untrusted'}}};expect(loadMcpConfig(undefined,project,{projectOverride:raw})).toEqual(loadMcpConfig(undefined,project));expect(getServerProvenance(undefined,project,{projectOverride:null})).toEqual(getServerProvenance(undefined,project));expect(Object.keys(loadMcpConfig(undefined,project,{projectOverride:raw}).mcpServers)).toEqual(['sole']);
 });
 for(const candidate of [null,{mcpServers:{replacement:{command:'never-run'}}}])it(`aliased project/global write target rejects virtual ${candidate===null?'removal':'record'}`,()=>{
  const before=readFileSync(path,'utf8');const alias=join(project,'global-alias.json');symlinkSync(path,alias);
  for(const target of [path,alias]){expect(()=>loadMcpConfig(target,project,{projectOverride:candidate})).toThrow('requires a distinct project Pi configuration target');expect(()=>getServerProvenance(target,project,{projectOverride:candidate})).toThrow('requires a distinct project Pi configuration target');expect(loadMcpConfig(target,project).mcpServers.disk.command).toBe('never-run-disk');}
  expect(readFileSync(path,'utf8')).toBe(before);
 });
 for(const raw of [[],42,{mcpServers:null},{'mcp-servers':null},{mcpServers:[]},{mcpServers:{unsafe:null}},{imports:['invalid']},{settings:[]},{mcpServers:{unsafe:'SECRET_SENTINEL'}}])it(`invalid virtual document rejects without file mutation: ${JSON.stringify(raw)}`,()=>{
  const before=readFileSync(path,'utf8');expect(()=>loadMcpConfig(undefined,project,{projectOverride:raw as any})).toThrow('Invalid virtual MCP project override.');expect(()=>getServerProvenance(undefined,project,{projectOverride:raw as any})).toThrow('Invalid virtual MCP project override.');expect(readFileSync(path,'utf8')).toBe(before);
 });
});
