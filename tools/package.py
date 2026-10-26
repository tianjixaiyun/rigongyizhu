"""Build the v19 handoff artifacts from an already tested checkout. Standard library only."""
from pathlib import Path
import argparse, hashlib, json, difflib, zipfile, re, subprocess
def digest(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def main():
 parser=argparse.ArgumentParser()
 parser.add_argument('--source',default=str(Path(__file__).resolve().parents[1]))
 parser.add_argument('--baseline',default=r'D:\codex\workspace\backups\rigong-v18.5-20261016')
 parser.add_argument('--out',default=r'D:\codex\workspace\outputs\rigong-v19')
 args=parser.parse_args()
 root=Path(args.source).resolve();base=Path(args.baseline).resolve();out=Path(args.out).resolve()
 out.mkdir(parents=True,exist_ok=True)
 original=json.loads((out/'original-files.sha256.json').read_text(encoding='utf-8-sig'))
 for rel,sha in original.items():
  if digest(base/rel).lower()!=sha.lower(): raise RuntimeError('Baseline changed: '+rel)
 assert (root/'vendor/cloud-sdk.js').read_bytes()==(base/'vendor/cloud-sdk.js').read_bytes(),'SDK changed'
 report=(out/'tests-final.txt').read_text(encoding='utf-8-sig')
 total=re.search(r'tests (\d+)',report);failed=re.search(r'fail (\d+)',report)
 if not total or not failed or int(failed.group(1))!=0: raise RuntimeError('Final tests have not passed')
 runtime=[]
 for folder in ['src','assets','vendor']:runtime.extend(p.relative_to(root).as_posix() for p in (root/folder).rglob('*') if p.is_file())
 runtime+=['index.html','manifest.webmanifest','sw.js','NOTICE.md']
 runtime=sorted(runtime)
 diff=''
 for rel in runtime:
  before=base/rel;after=root/rel
  if before.exists() and before.read_bytes()==after.read_bytes():continue
  a=before.read_bytes().decode('utf-8-sig').splitlines(keepends=True) if before.exists() else []
  b=after.read_bytes().decode('utf-8-sig').splitlines(keepends=True)
  diff+=''.join(difflib.unified_diff(a,b,fromfile='a/'+rel if before.exists() else '/dev/null',tofile='b/'+rel))
 patch=out/'changes-v19.patch';patch.write_text(diff,encoding='utf-8',newline='\n')
 check=subprocess.run(['git','-c','core.autocrlf=false','apply','--check',str(patch)],cwd=base,capture_output=True,text=True,encoding='utf-8')
 if check.returncode: raise RuntimeError('Patch did not validate: '+check.stderr)
 manifest={'version':'19','baselineVersion':'18.5','sourceUrl':'https://72e0ed71f79541ef8f9c1980e8169a62.sg.agentos-app.run/',
   'buildDate':'2026-10-16','productionDeployed':False,'tests':{'total':int(total.group(1)),'failed':0},
   'runtimeFiles':{rel:digest(root/rel) for rel in runtime},
   'verificationLimits':['No production authentication/database deployment','No real mobile visual check','No real browser PWA installation; DOM/SQL/worker VM tests only']}
 (out/'release-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
 runtime_zip=out/'网站运行文件-v19.zip'
 with zipfile.ZipFile(runtime_zip,'w',zipfile.ZIP_DEFLATED) as z:
  for rel in runtime:z.write(root/rel,rel)
 files=runtime+['package.json','package-lock.json','README.md','发给WorkBuddy.txt','回滚说明.md']
 for folder in ['backend','tests','tools']:
  files.extend(p.relative_to(root).as_posix() for p in (root/folder).rglob('*') if p.is_file() and '__pycache__' not in p.parts)
 handoff=out/'WorkBuddy更新包-v19.zip'
 with zipfile.ZipFile(handoff,'w',zipfile.ZIP_DEFLATED) as z:
  for rel in sorted(set(files)):z.write(root/rel,rel)
  for name in ['original-files.sha256.json','changes-v19.patch','release-manifest.json','tests-final.txt','checks-final.txt','测试报告.md']:
   z.write(out/name,name)
  z.write(runtime_zip,'release/网站运行文件-v19.zip')
 with zipfile.ZipFile(out/'原站公开前端备份-v18.5.zip','w',zipfile.ZIP_DEFLATED) as z:
  for p in sorted(base.rglob('*')):
   if p.is_file():z.write(p,p.relative_to(base).as_posix())
 for artifact in [handoff,runtime_zip,out/'原站公开前端备份-v18.5.zip']:
  with zipfile.ZipFile(artifact) as z:
   assert z.testzip() is None,'ZIP corruption'
   assert not any('node_modules/' in n or '.env' in n for n in z.namelist())
 artifacts={p.name:{'bytes':p.stat().st_size,'sha256':digest(p)} for p in [handoff,runtime_zip,patch,out/'原站公开前端备份-v18.5.zip']}
 (out/'artifacts.sha256.json').write_text(json.dumps(artifacts,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
 print(json.dumps({'tests':manifest['tests'],'runtimeFiles':len(runtime),'patchCheck':'passed','sdkUnchanged':True,'artifacts':artifacts},ensure_ascii=True))
if __name__=='__main__':main()
