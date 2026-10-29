export const cases = [
  ...['general', 'flat', 'second', 'mask', 'heavy', 'animated', 'tiles', 'wide', 'gradient', 'smil', 'dark']
    .map((mark) => ({ name: `${mark}/fast`, mark, options: { mode: 'fast' } })),
  ...['tiles', 'gradient'].map((mark) => ({ name: `${mark}/release`, mark, options: { mode: 'release' } })),
  { name: 'transparent-aliases', mark: 'general', options: { mode: 'fast', sizes: [32, 180, 32], bg: 'none', padding: 10, manifest: false } },
  { name: 'custom-manifest', mark: 'animated', options: { mode: 'fast', sizes: [180, 32], base: '/app/',
    manifest: { name: 'My app', theme_color: '#123456' }, vars: { hub: '#ee3344' }, animation: false, padding: 12 } },
];
