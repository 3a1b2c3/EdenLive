// Every mesh class owns a distinct hue so adjacent entities keep a hard
// colour boundary. The coupe is the yellow mass named in the prompt; each
// profession is one saturated hue (matching its ground ring); the four
// building palettes are four different wall colours, not grey steps.
export const CAR_OPTIONS = { preset: 'coupe', width: 1.95, length: 4.2, height: 1.35,
  spoiler: true, stripe: true, wheelbase: .72, colors: { body: '#ffd400', roof: '#ffd400', window: '#1a3040',
    chassis: '#2a2a2a', wheel: '#1a1a1a', hub: '#d0d0d0', accent: '#c04000', lamp: '#ffffff' } };
export const CHARACTER_OPTIONS = ['mage','warrior','nurse','firefighter','police','worker'].map((preset,i) => ({
  preset, height: [2.45,2.4,2.25,2.4,2.35,2.35][i], headScale: 1.12, stride: .6,
  ...(preset === 'police' ? { weapon: 'none', offhand: 'radio' } : {}),
  colors: [{top:'#a000ff',cloak:'#a000ff',magic:'#a000ff'}, {top:'#ff2000',accent:'#ff2000'},
    {top:'#00d8d8',pants:'#00d8d8'}, {top:'#ff8000',pants:'#ff8000',reflective:'#ff8000'},
    {top:'#0060ff',pants:'#0060ff'}, {top:'#00c000',accent:'#00c000'}][i]
}));
const PALETTES = [
  {wall:'#e07040',roof:'#2f6b6e',trim:'#ffd0a0',window:'#1e3a48',accent:'#c04030'},
  {wall:'#20b8a0',roof:'#24565a',trim:'#d4f0c8',window:'#1e3a48',accent:'#ffc44d'},
  {wall:'#e8c040',roof:'#7a5a38',trim:'#ffe9a8',window:'#1e3a48',accent:'#e85a30'},
  {wall:'#4a8ad8',roof:'#3a5a88',trim:'#e8e4d0',window:'#1e3a48',accent:'#3dccc0'},
];
export function buildingOptions(b) { return { preset: ['shop','office','apartment','shop'][b.index % 4],
  massing:'block',width:b.w,depth:b.d,floors:2,floorHeight:b.h/2,windows:3,facade:'ribbon',balconies:false,
  storefront:true,awning:false,bands:true,roof:'flat', colors: PALETTES[b.index % 4] }; }
