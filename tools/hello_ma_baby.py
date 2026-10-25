"""Writes public/audio/hello_ma_baby.mid and public/js/hellomababy.json from one note list.
"Hello! Ma Baby" (Joseph E. Howard & Ida Emerson, 1899) is in the public domain. Arrangement by the Callective, 1998-style."""
import json, struct, pathlib
C4=60
N={'C4':60,'D4':62,'E4':64,'F4':65,'G4':67,'A4':69,'B4':71,'C5':72,'D5':74,'E5':76,'F5':77,'G5':79}
# (note, beats) per phrase; '-' = rest
P=[
 [('G4',1),('E4',.5),('G4',.5),('A4',1),('G4',1)],              # Hello ma baby
 [('G4',1),('E4',.5),('G4',.5),('A4',1),('G4',1)],              # Hello ma honey
 [('G4',1),('E4',.5),('G4',.5),('A4',.5),('C5',.5),('B4',.5),('A4',.5)],   # Hello ma ragtime
 [('G4',3),('-',1)],                                             # gal
 [('C5',.5),('C5',.5),('C5',.5),('B4',.5),('A4',1),('G4',1)],    # Send me a kiss by wire
 [('A4',.5),('A4',.5),('A4',.5),('G4',.5),('F4',1),('E4',1)],    # Baby my heart's on fire
 [('G4',1),('E4',.5),('G4',.5),('A4',1),('G4',1)],              # If you refuse me
 [('G4',1),('E4',.5),('G4',.5),('A4',1),('G4',1)],              # Honey you'll lose me
 [('G4',.5),('A4',.5),('B4',.5),('C5',.5),('D5',1),('B4',1)],    # Then you'll be left a-
 [('C5',3),('-',1)],                                             # lone
 [('E5',1.5),('D5',.5),('C5',.5),('A4',.5),('C5',1)],            # Oh baby, telephone
 [('G4',.5),('E4',.5),('G4',.5),('A4',.5),('D5',1),('B4',1)],    # and tell me I'm your
 [('C5',3),('-',1)],                                             # own
]
CH=['C','C','C','C','F','C','C','C','G','C','F','G','C']   # one chord per 4-beat bar (one bar per phrase)
CHORD={'C':[48,52,55],'F':[41,45,48],'G':[43,47,50]}
mel=[];t=0
for ph in P:
  for n,b in ph:
    if n!='-': mel.append([t,b,N[n]])
    t+=b
bars=[]
for i,c in enumerate(CH):
  r=CHORD[c]; s=i*4
  bars+= [[s,.9,r[0]-12],[s+1,.45,r[0]],[s+1,.45,r[1]],[s+1,.45,r[2]],[s+2,.9,r[2]-12],[s+3,.45,r[0]],[s+3,.45,r[1]],[s+3,.45,r[2]]]
root=pathlib.Path(__file__).resolve().parent.parent
json.dump({"bpm":132,"len":len(CH)*4,"mel":mel,"acc":bars},open(root/'public/js/hellomababy.json','w'))
# --- standard MIDI file, format 1, two tracks ---
TPQ=480
def vlq(n):
  b=[n&0x7f]; n>>=7
  while n: b.insert(0,(n&0x7f)|0x80); n>>=7
  return bytes(b)
def track(events,prog,ch,name):
  ev=[(0,b'\xff\x03'+vlq(len(name))+name.encode())]
  ev.append((0,bytes([0xC0|ch,prog])))
  for s,d,n in events:
    ev.append((int(s*TPQ),bytes([0x90|ch,n,96]))); ev.append((int((s+d)*TPQ)-10,bytes([0x80|ch,n,0])))
  ev.sort(key=lambda e:(e[0],e[1][0]&0xf0==0x90))
  out=b'';last=0
  for tk,data in ev: out+=vlq(tk-last)+data; last=tk
  out+=vlq(0)+b'\xff\x2f\x00'
  return b'MTrk'+struct.pack('>I',len(out))+out
tempo=b'MTrk'; tt=vlq(0)+b'\xff\x51\x03'+struct.pack('>I',int(60e6/132))[1:]+vlq(0)+b'\xff\x2f\x00'; tempo+=struct.pack('>I',len(tt))+tt
data=b'MThd'+struct.pack('>IHHH',6,1,3,TPQ)+tempo+track(mel,0x51,0,'Lead (Square)')+track(bars,0x00,1,'Ragtime Piano')
(root/'public/audio/hello_ma_baby.mid').write_bytes(data)
print(len(mel),"melody notes,",len(data),"bytes")
