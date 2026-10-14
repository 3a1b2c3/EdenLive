export const PLATFORMS = [
  {id:'launch', x:0, z:0, w:10, d:10, top:0, bottom:-3.8},
  {id:'ridge', x:0, z:-8.5, w:6, d:6, top:0.75, bottom:-3.5},
  {id:'steps', x:7.5, z:-8.5, w:6, d:6, top:1.5, bottom:-3},
  {id:'lookout', x:15, z:-8.5, w:6, d:6, top:2.25, bottom:-2.8},
  {id:'cove', x:15, z:-16, w:6, d:6, top:1.25, bottom:-4},
  {id:'spire', x:7.5, z:-16, w:6, d:6, top:2.25, bottom:-3},
  {id:'summit', x:0, z:-16, w:7, d:6, top:3.3, bottom:-3.5}
];
export const COINS = [
  {id:'c01',x:0,z:-2,platform:'launch'}, {id:'c02',x:0,z:-3.8,platform:'launch'},
  {id:'c03',x:0,z:-7,platform:'ridge'}, {id:'c04',x:0,z:-9,platform:'ridge'},
  {id:'c05',x:6,z:-8.5,platform:'steps'}, {id:'c06',x:8.5,z:-8.5,platform:'steps'},
  {id:'c07',x:14,z:-8.5,platform:'lookout'}, {id:'c08',x:16,z:-8.5,platform:'lookout'},
  {id:'c09',x:15,z:-16,platform:'cove'}, {id:'c10',x:7.5,z:-16,platform:'spire'},
  {id:'c11',x:1,z:-16,platform:'summit'}, {id:'c12',x:-1.5,z:-16,platform:'summit'}
].map(c=>({...c,y:PLATFORMS.find(p=>p.id===c.platform).top+0.85}));
