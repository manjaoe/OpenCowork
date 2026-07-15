export interface PromptItem {
  id: string
  title: string
  prompt: string
  category: string
}

/** Category keys map to i18n `drawPage.promptCat.*`; `all` is synthesized in the UI. */
export const PROMPT_CATEGORIES = [
  'portrait',
  'landscape',
  'product',
  'illustration',
  'threeD',
  'photography'
] as const

export type PromptCategory = (typeof PROMPT_CATEGORIES)[number]

/** A small, hand-curated offline set. Optional online sources merge on top of this. */
export const BUILTIN_PROMPTS: PromptItem[] = [
  {
    id: 'p-portrait-cinematic',
    category: 'portrait',
    title: 'Cinematic portrait / 电影感人像',
    prompt:
      'cinematic close-up portrait of a young woman, soft rim lighting, shallow depth of field, 85mm lens, film grain, moody color grading, highly detailed skin texture, natural expression'
  },
  {
    id: 'p-portrait-studio',
    category: 'portrait',
    title: 'Studio headshot / 影棚证件照',
    prompt:
      'professional studio headshot, clean neutral gray background, three-point softbox lighting, sharp focus on eyes, business attire, subtle catchlight, corporate look'
  },
  {
    id: 'p-portrait-cyberpunk',
    category: 'portrait',
    title: 'Cyberpunk portrait / 赛博朋克人像',
    prompt:
      'cyberpunk portrait, neon magenta and cyan rim light, rainy night city bokeh background, reflective wet skin, futuristic visor, cinematic, ultra detailed'
  },
  {
    id: 'p-landscape-golden',
    category: 'landscape',
    title: 'Golden-hour valley / 黄金时刻山谷',
    prompt:
      'sweeping mountain valley at golden hour, volumetric god rays through mist, winding river, dramatic clouds, ultra wide angle, epic scale, photorealistic'
  },
  {
    id: 'p-landscape-aurora',
    category: 'landscape',
    title: 'Aurora over lake / 湖上极光',
    prompt:
      'vivid green aurora borealis reflecting on a still glacial lake, snow-capped peaks, star-filled sky, long exposure, crisp cold atmosphere, high detail'
  },
  {
    id: 'p-landscape-desert',
    category: 'landscape',
    title: 'Minimal desert dunes / 极简沙丘',
    prompt:
      'minimalist desert dunes at sunrise, soft gradient sky, long shadows, smooth sand ripples, warm tones, fine art photography, negative space'
  },
  {
    id: 'p-product-bottle',
    category: 'product',
    title: 'Cosmetic bottle / 化妆品瓶',
    prompt:
      'premium cosmetic serum bottle product shot, glossy reflective surface, water splash, studio gradient background, soft box highlights, macro detail, commercial advertising'
  },
  {
    id: 'p-product-sneaker',
    category: 'product',
    title: 'Floating sneaker / 悬浮球鞋',
    prompt:
      'hero product shot of a futuristic sneaker floating, dynamic dust particles, bold gradient backdrop, dramatic rim lighting, hyper detailed materials, advertising key visual'
  },
  {
    id: 'p-product-tech',
    category: 'product',
    title: 'Tech gadget flatlay / 数码平铺',
    prompt:
      'clean flat lay of a tech gadget on matte concrete, top-down view, soft even lighting, muted color palette, organized composition, minimal, editorial'
  },
  {
    id: 'p-illu-storybook',
    category: 'illustration',
    title: 'Storybook scene / 绘本场景',
    prompt:
      'whimsical children storybook illustration, cozy cottage in an autumn forest, warm gouache textures, soft shapes, gentle lighting, hand-painted feel'
  },
  {
    id: 'p-illu-flat',
    category: 'illustration',
    title: 'Flat vector scene / 扁平矢量',
    prompt:
      'flat design vector illustration, modern workspace scene, bold geometric shapes, limited harmonious palette, subtle grain, clean lines, trendy'
  },
  {
    id: 'p-illu-anime',
    category: 'illustration',
    title: 'Anime key visual / 动漫主视觉',
    prompt:
      'anime key visual, a girl standing on a rooftop at sunset, dynamic wind, vibrant clouds, detailed background, cel shading, high quality, studio production'
  },
  {
    id: 'p-3d-isometric',
    category: 'threeD',
    title: 'Isometric room / 等距房间',
    prompt:
      'cute isometric miniature bedroom, soft clay render, pastel colors, ambient occlusion, tilt-shift, high detail, blender style, 3d icon'
  },
  {
    id: 'p-3d-character',
    category: 'threeD',
    title: 'Stylized 3D character / 风格化角色',
    prompt:
      'stylized 3d character render, friendly robot mascot, smooth subsurface materials, studio lighting, octane render, pixar-like, clean background'
  },
  {
    id: 'p-3d-product',
    category: 'threeD',
    title: 'Abstract 3D shapes / 抽象几何',
    prompt:
      'abstract 3d composition, glossy metallic and translucent glass shapes, soft studio lighting, gradient background, depth of field, premium render'
  },
  {
    id: 'p-photo-street',
    category: 'photography',
    title: 'Street photography / 街头摄影',
    prompt:
      'candid street photography, rainy neon-lit alley at night, reflections on wet pavement, motion blur, 35mm, documentary style, high dynamic range'
  },
  {
    id: 'p-photo-food',
    category: 'photography',
    title: 'Food photography / 美食摄影',
    prompt:
      'appetizing food photography, rustic wooden table, natural window light, shallow depth of field, steam rising, fresh ingredients, editorial styling'
  },
  {
    id: 'p-photo-macro',
    category: 'photography',
    title: 'Macro nature / 微距自然',
    prompt:
      'extreme macro photograph of a dew-covered leaf, iridescent water droplets, soft morning light, bokeh, razor sharp detail, natural colors'
  }
]
