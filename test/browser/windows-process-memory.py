"""Read-only Windows sampler. Only the caller's explicitly owned subtree.

Protocol: one JSON object per line: init(rootPid,parentPid,name), sample,
remaining, close. Creation FILETIME identifies each PID incarnation. No process
command lines/environments, memory contents, signals, forced GC or trims.
"""
import ctypes as c
from ctypes import wintypes as w
import json, os, sys, time, pathlib, tempfile
if sys.platform != 'win32':
    raise RuntimeError('Windows native observation only')
k=c.WinDLL('kernel32',use_last_error=True)
class ENTRY(c.Structure):
    _fields_=[('dwSize',w.DWORD),('cntUsage',w.DWORD),('pid',w.DWORD),('heap',c.c_size_t),('module',w.DWORD),('threads',w.DWORD),('parent',w.DWORD),('priority',w.LONG),('flags',w.DWORD),('name',w.WCHAR*260)]
class COUNTERS(c.Structure):
    _fields_=[('cb',w.DWORD),('faults',w.DWORD)]+[(n,c.c_size_t) for n in ['peakWorkingSet','workingSet','peakPaged','paged','peakNonPaged','nonPaged','pagefile','peakPagefile','privateUsage']]
class BASIC(c.Structure):
    _fields_=[('exitStatus',w.LONG),('peb',c.c_void_p),('affinity',c.c_size_t),('priority',w.LONG),('pid',c.c_size_t),('parent',c.c_size_t)]
# Dynamic linking; fail closed on an unsupported OS/API. No PEB dereference.
native=c.WinDLL('ntdll',use_last_error=True).NtQueryInformationProcess
native.argtypes=[w.HANDLE,w.ULONG,c.c_void_p,w.ULONG,c.POINTER(w.ULONG)];native.restype=w.LONG
k.CreateToolhelp32Snapshot.argtypes=[w.DWORD,w.DWORD];k.CreateToolhelp32Snapshot.restype=w.HANDLE
for fn in ['Process32FirstW','Process32NextW']:
    getattr(k,fn).argtypes=[w.HANDLE,c.POINTER(ENTRY)];getattr(k,fn).restype=w.BOOL
k.CloseHandle.argtypes=[w.HANDLE];k.CloseHandle.restype=w.BOOL
k.OpenProcess.argtypes=[w.DWORD,w.BOOL,w.DWORD];k.OpenProcess.restype=w.HANDLE
k.WaitForSingleObject.argtypes=[w.HANDLE,w.DWORD];k.WaitForSingleObject.restype=w.DWORD
k.GetProcessTimes.argtypes=[w.HANDLE]+[c.POINTER(w.FILETIME)]*4;k.GetProcessTimes.restype=w.BOOL
k.K32GetProcessMemoryInfo.argtypes=[w.HANDLE,c.POINTER(COUNTERS),w.DWORD];k.K32GetProcessMemoryInfo.restype=w.BOOL
if len(sys.argv)==3 and sys.argv[1]=='--allocated-size':
    original=pathlib.Path(sys.argv[2]);p=original.resolve(strict=True)
    if original.is_symlink() or p!=original.absolute() or p.name!='physical-1_25GiB.tflite' or not p.parent.name.startswith('model-lens-lifecycle-') or p.parent.parent!=pathlib.Path(tempfile.gettempdir()).resolve() or p.parent.stat().st_file_attributes&0x400:raise RuntimeError('Not an owned physical fixture path')
    k.GetCompressedFileSizeW.argtypes=[w.LPCWSTR,c.POINTER(w.DWORD)];k.GetCompressedFileSizeW.restype=w.DWORD
    high=w.DWORD();c.set_last_error(0);low=k.GetCompressedFileSizeW(str(p),c.byref(high))
    if low==0xffffffff and c.get_last_error():raise c.WinError(c.get_last_error())
    print(json.dumps({'allocatedBytes':(high.value<<32)|low}));sys.exit(0)
def snapshot():
    handle=k.CreateToolhelp32Snapshot(2,0)
    if handle==c.c_void_p(-1).value:raise c.WinError(c.get_last_error())
    rows={};entry=ENTRY();entry.dwSize=c.sizeof(entry)
    try:
        ok=k.Process32FirstW(handle,c.byref(entry))
        if not ok:raise c.WinError(c.get_last_error())
        while ok:
            rows[entry.pid]={'pid':int(entry.pid),'parent':int(entry.parent),'name':entry.name.lower()}
            if len(rows)>16384:raise RuntimeError('Process snapshot budget exceeded')
            ok=k.Process32NextW(handle,c.byref(entry))
        if c.get_last_error()!=18:raise c.WinError(c.get_last_error())
        return rows
    finally:k.CloseHandle(handle)
def inspect(row,memory=False):
    handle=k.OpenProcess(0x1000|0x100000|(0x10 if memory else 0),False,row['pid'])
    if not handle:
        error=c.get_last_error()
        if error in [87,1168]:return None
        raise c.WinError(error)
    try:
        state=k.WaitForSingleObject(handle,0)
        if state==0:return None
        if state!=258:raise RuntimeError('Native liveness unavailable')
        basic=BASIC();length=w.ULONG();status=native(handle,0,c.byref(basic),c.sizeof(basic),c.byref(length))
        if status<0 or length.value!=c.sizeof(basic):raise RuntimeError('Native parent identity unavailable: '+hex(status&0xffffffff))
        if basic.pid!=row['pid'] or basic.parent!=row['parent']:return None
        times=[w.FILETIME() for _ in range(4)]
        if not k.GetProcessTimes(handle,*[c.byref(t) for t in times]):raise c.WinError(c.get_last_error())
        # lpExitTime is unspecified for a live process. Use the zero-time handle
        # wait above instead; never infer liveness from those FILETIME fields.
        result={**row,'startTicks':str((times[0].dwHighDateTime<<32)|times[0].dwLowDateTime),'state':'R'}
        if row.get('startTicks') and row['startTicks']!=result['startTicks']:return None
        if memory:
            if k.WaitForSingleObject(handle,0)==0:return None
            values=COUNTERS();values.cb=c.sizeof(values)
            if not k.K32GetProcessMemoryInfo(handle,c.byref(values),values.cb):raise c.WinError(c.get_last_error())
            if values.workingSet<=0:raise RuntimeError('Owned working set missing')
            result.update(rssBytes=int(values.workingSet),privateCommitBytes=int(values.privateUsage))
        return result
    finally:k.CloseHandle(handle)
class Observer:
    def __init__(self):self.root=None;self.known={}
    def init(self,request):
        if self.root:raise RuntimeError('Already initialized')
        pid=request.get('rootPid');parent=request.get('parentPid');name=request.get('name')
        if type(pid)!=int or pid<1 or parent!=os.getppid() or name not in ['chrome.exe','msedge.exe']:raise RuntimeError('Invalid caller/root')
        row=snapshot().get(pid)
        if not row or row['parent']!=parent or row['name']!=name:raise RuntimeError('Root is not a directly owned browser')
        root=inspect(row)
        if not root:raise RuntimeError('Root exited')
        self.root=root;self.known[(pid,root['startTicks'])]=root
        return {'root':root,'backend':'Windows Toolhelp32/GetProcessTimes/K32GetProcessMemoryInfo','counter':'WorkingSetSize','supplementary':'PrivateUsage'}
    def collect(self,remaining=False):
        if not self.root:raise RuntimeError('Not initialized')
        table=snapshot();live={}
        for (pid,ticks),known in list(self.known.items()):
            row=table.get(pid)
            if not row:continue
            current=inspect(row)
            if current and current['startTicks']==ticks:live[pid]=current
        if not remaining and self.root['pid'] not in live:raise RuntimeError('Owned root exited or PID reused')
        if not remaining:
            # Only a currently live, creation-verified parent may introduce a
            # child. A dead parent's recycled PID never expands ownership.
            changed=True
            while changed:
                changed=False
                for pid,row in table.items():
                    if pid in live or row['parent'] not in live:continue
                    child=inspect(row)
                    if child and int(child['startTicks'])>=int(live[row['parent']]['startTicks']):
                        live[pid]=child;self.known[(pid,child['startTicks'])]=child;changed=True
                        if len(self.known)>1024:raise RuntimeError('Owned identity budget exceeded')
        rows=[]
        for pid,row in live.items():
            current=inspect(row,memory=not remaining)
            if current and current['startTicks']==row['startTicks']:rows.append(current)
        return {'rows':rows,'identities':[{'pid':pid,'startTicks':ticks} for pid,ticks in self.known],'observedAtNs':str(time.monotonic_ns())}
observer=Observer()
for line in sys.stdin:
    try:
        if len(line)>4096:raise RuntimeError('Request budget exceeded')
        request=json.loads(line);action=request.get('action')
        if action=='close':print(json.dumps({'ok':True}),flush=True);break
        if action=='init':result=observer.init(request)
        elif action in ['sample','remaining']:result=observer.collect(action=='remaining')
        elif action=='self-test':
            row=snapshot().get(os.getpid());result=inspect(row,True)
            if result['parent']!=os.getppid():raise RuntimeError('Parent mismatch')
        elif action=='self-test-negative':
            row=snapshot().get(os.getpid());valid=inspect(row)
            if inspect({**row,'parent':row['parent']+1},True) is not None or inspect({**valid,'startTicks':str(int(valid['startTicks'])+1)},True) is not None:raise RuntimeError('Invalid identity accepted')
            result={'invalidParentRejected':True,'reusedCreationRejected':True}
        else:raise RuntimeError('Unknown action')
        print(json.dumps({'ok':True,'result':result}),flush=True)
    except Exception as error:
        print(json.dumps({'ok':False,'error':str(error)}),flush=True)
