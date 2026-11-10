import {describe,it,expect} from 'vitest';
import {execFileSync} from 'node:child_process';
import {readFileSync,existsSync,lstatSync} from 'node:fs';
import {resolve} from 'node:path';
const git=(...args:string[])=>execFileSync('git',args,{encoding:'utf8'}).trim();
describe('independent product repository boundary',()=>{
 it('has a parentless native root and only its own remote',()=>{
  const roots=git('rev-list','--max-parents=0','HEAD').split('\n');expect(roots).toHaveLength(1);
  expect(git('show','-s','--format=%s',roots[0]!)).toBe('chore: initialize independent product repository');
  expect(git('rev-list','--parents','-n','1',roots[0]!).split(' ')).toHaveLength(1);
  expect(git('remote').split('\n')).toEqual(['origin']);
  expect(git('remote','get-url','origin')).toBe('https://github.com/0x-xrpl/VEREQO.git');
  expect(git('rev-parse','--show-toplevel')).toBe(process.cwd());
 });
 it('has no linked Git objects or tracked symlinks/gitlinks',()=>{
  expect(lstatSync('.git').isDirectory()).toBe(true);expect(existsSync('.git/objects/info/alternates')).toBe(false);expect(existsSync('.gitmodules')).toBe(false);
  expect(git('ls-files','--stage').split('\n').every(line=>/^100(?:644|755) /.test(line))).toBe(true);
 });
 it('resolves its source imports within this repository and has no local package dependency',()=>{
  const pkg=JSON.parse(readFileSync('package.json','utf8'));expect(pkg.name).toBe('vereqo');
  expect(JSON.stringify({...pkg.dependencies,...pkg.devDependencies})).not.toMatch(/file:|link:|workspace:/);
  const paths=git('ls-files').split('\n').filter(p=>/\.(ts|tsx|css)$/.test(p));
  for(const path of paths){const s=readFileSync(path,'utf8');for(const match of s.matchAll(/(?:from|import)\s*['"](\.[^'"]+)['"]/g)){const target=resolve(path,'..',match[1]!);expect(target.startsWith(process.cwd()+'/')).toBe(true);expect([target,target+'.ts',target+'.tsx',target.replace(/\.js$/,'.ts'),target+'/index.ts'].some(candidate=>existsSync(candidate)&&lstatSync(candidate).isFile())).toBe(true);}}
 });
});
