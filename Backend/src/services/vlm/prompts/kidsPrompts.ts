import { PromptContext, SpecializedPrompt, buildAllowedValuesReference, formatAllowedValuesForPrompt } from './basePrompt';

/**
 * KIDS DEPARTMENT SPECIALIZED PROMPTS
 * 
 * Three specialized prompts for children's fashion:
 * - KIDS_UPPER: Age-appropriate tops, t-shirts, shirts
 * - KIDS_LOWER: Pants, shorts, jeans, skirts
 * - KIDS_ALL_IN_ONE: Rompers, dungarees, frocks, complete sets
 */

export function buildKidsUpperPrompt(context: PromptContext): SpecializedPrompt {
  const allowedValuesRef = buildAllowedValuesReference(context.schema);
  
  return {
    systemPrompt: `You are a KIDS UPPER WEAR specialist. Focus on age-appropriate tops, t-shirts, shirts, and sweaters for children.

⚠️ CRITICAL INSTRUCTION:
All extracted values MUST match the allowed values from the database schema.
Do NOT suggest or invent values. Use ONLY the exact enum values provided for each attribute.`,
    
    attributeInstructions: `
DATABASE ALLOWED VALUES FOR THIS CATEGORY:
${Object.entries(allowedValuesRef)
  .filter(([key]) => !['waist_rise', 'leg_style', 'inseam', 'formal_styling', 'bottom_type'].some(skip => key.toLowerCase().includes(skip)))
  .map(([key, values]) => `- ${key}: ${formatAllowedValuesForPrompt(values)}`)
  .join('\n')}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TIER 1: CRITICAL ATTRIBUTES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📍 SLEEVE LENGTH:
${allowedValuesRef.sleeveLength || allowedValuesRef.sleeve_length ? `
ALLOWED VALUES: ${formatAllowedValuesForPrompt(allowedValuesRef.sleeveLength || allowedValuesRef.sleeve_length || [])}

⚠️ Use exact enum from allowed list.
` : 'Sleeveless, short, long'}

📍 NECKLINE:
${allowedValuesRef.necklineType ? `
ALLOWED VALUES: ${allowedValuesRef.necklineType.join(', ')}

⚠️ Use ONLY these exact values for kids necklines.
` : 'Round, polo, hooded'}

📍 PATTERN:
${allowedValuesRef.patternCategory ? `
ALLOWED VALUES: ${allowedValuesRef.patternCategory.join(', ')}

⚠️ CRITICAL: Use ONLY these values for pattern classification.
` : 'Cartoon prints, solid, stripes'}

TIER 2: STANDARD ATTRIBUTES

- COLOR: ${allowedValuesRef.color ? `Use from: ${formatAllowedValuesForPrompt(allowedValuesRef.color)}` : 'Bright primary colors, pastels'}
- FIT: ${allowedValuesRef.fitType ? `Use from: ${formatAllowedValuesForPrompt(allowedValuesRef.fitType)}` : 'Comfortable, regular'}
- FABRIC: ${allowedValuesRef.fabric ? `Use from: ${formatAllowedValuesForPrompt(allowedValuesRef.fabric)}` : 'Soft cotton, jersey, fleece'}
- CLOSURE: ${allowedValuesRef.closureType ? `Use from: ${formatAllowedValuesForPrompt(allowedValuesRef.closureType)}` : 'Pullover, buttons, snap buttons'}

 TIER 3: OPTIONAL ATTRIBUTES

- PRINT_THEME: ${allowedValuesRef.printTheme ? `Use from: ${formatAllowedValuesForPrompt(allowedValuesRef.printTheme)}` : 'Cartoon characters, animals, sports'}
- COMFORT_FEATURES: Tagless, soft seams, breathable
- SAFETY: No small buttons, child-safe materials

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
❌ SKIP THESE ATTRIBUTES (Not applicable to kids upper wear): 
WAIST_RISE, LEG_STYLE, FORMAL_STYLING, BOTTOM_TYPE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

⚠️ FINAL RULE: All values from database allowed list. No invented values. Use NULL if attribute not present.
`,
    
    focusAreas: [
      'Database enum validation',
      'Comfortable fit for movement',
      'Soft, child-safe fabrics',
      'Fun prints and colors',
      'Easy wear features',
      'Age-appropriate styling'
    ],
    
    skipAttributes: [
      'waist_rise', 'leg_style', 'inseam', 'formal_styling',
      'sexy_style', 'body_conscious', 'bottom_type'
    ]
  };
}

export function buildKidsLowerPrompt(context: PromptContext): SpecializedPrompt {
  const allowedValuesRef = buildAllowedValuesReference(context.schema);
  
  return {
    systemPrompt: `You are a KIDS LOWER WEAR specialist. Focus on pants, shorts, jeans, and skirts for children.

⚠️ CRITICAL INSTRUCTION:
All extracted values MUST match the allowed values from the database schema.
Do NOT suggest or invent values. Use ONLY the exact enum values provided for each attribute.`,
    
    attributeInstructions: `
DATABASE ALLOWED VALUES FOR THIS CATEGORY:
${Object.entries(allowedValuesRef)
  .filter(([key]) => !['sleeve_length', 'neckline', 'formal_styling', 'collar_type'].some(skip => key.toLowerCase().includes(skip)))
  .map(([key, values]) => `- ${key}: ${formatAllowedValuesForPrompt(values)}`)
  .join('\n')}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TIER 1: CRITICAL ATTRIBUTES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📍 BOTTOM TYPE:
${allowedValuesRef.bottomType ? `
ALLOWED VALUES: ${allowedValuesRef.bottomType.join(', ')}

⚠️ Use ONLY these exact values for kids lower wear.
` : 'Pants, jeans, shorts, skirt, joggers'}

📍 LENGTH:
${allowedValuesRef.length ? `
ALLOWED VALUES: ${formatAllowedValuesForPrompt(allowedValuesRef.length)}

⚠️ Use exact enum from list.
` : 'Full, cropped, shorts'}

📍 WAISTBAND:
${allowedValuesRef.waistbandType ? `
ALLOWED VALUES: ${formatAllowedValuesForPrompt(allowedValuesRef.waistbandType)}

⚠️ Use exact enum from allowed list.
` : 'Elastic, adjustable, drawstring'}

TIER 2: STANDARD ATTRIBUTES

- COLOR: ${allowedValuesRef.color ? `Use from: ${formatAllowedValuesForPrompt(allowedValuesRef.color)}` : 'Primary color, playful tones'}
- FIT: ${allowedValuesRef.fitType ? `Use from: ${formatAllowedValuesForPrompt(allowedValuesRef.fitType)}` : 'Comfortable, regular, elastic waist'}
- FABRIC: ${allowedValuesRef.fabric ? `Use from: ${formatAllowedValuesForPrompt(allowedValuesRef.fabric)}` : 'Soft cotton, stretch denim'}
- CLOSURE: ${allowedValuesRef.closureType ? `Use from: ${formatAllowedValuesForPrompt(allowedValuesRef.closureType)}` : 'Zipper, elastic, snap button'}

 TIER 3: OPTIONAL ATTRIBUTES

- POCKETS: ${allowedValuesRef.pocketType ? `Use from: ${formatAllowedValuesForPrompt(allowedValuesRef.pocketType)}` : 'Fun pocket designs, reinforced'}
- KNEE_PADDING: For active play
- COMFORT: Stretchy, non-restrictive

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
❌ SKIP THESE ATTRIBUTES (Not applicable to kids lower wear):
SLEEVE_LENGTH, NECKLINE, FORMAL_STYLING, COLLAR_TYPE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

⚠️ FINAL RULE: All values from database allowed list. No invented values. Use NULL if attribute not present.
`,
    
    focusAreas: [
      'Database enum validation',
      'Comfortable waistband',
      'Room for movement',
      'Durable fabric',
      'Easy closure systems',
      'Age-appropriate length'
    ],
    
    skipAttributes: [
      'sleeve_length', 'neckline', 'formal_styling', 'sexy_cut',
      'body_conscious', 'low_rise', 'collar_type'
    ]
  };
}

export function buildKidsAllInOnePrompt(context: PromptContext): SpecializedPrompt {
  const allowedValuesRef = buildAllowedValuesReference(context.schema);
  
  return {
    systemPrompt: `You are a KIDS FULL OUTFIT specialist. Focus on rompers, dungarees, frocks, and complete sets for children.

⚠️ CRITICAL INSTRUCTION:
All extracted values MUST match the allowed values from the database schema.
Do NOT suggest or invent values. Use ONLY the exact enum values provided for each attribute.`,
    
    attributeInstructions: `
DATABASE ALLOWED VALUES FOR THIS CATEGORY:
${Object.entries(allowedValuesRef)
  .map(([key, values]) => `- ${key}: ${formatAllowedValuesForPrompt(values)}`)
  .join('\n')}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TIER 1: CRITICAL ATTRIBUTES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📍 GARMENT TYPE:
${allowedValuesRef.garmentType || allowedValuesRef.garment_type ? `
ALLOWED VALUES: ${formatAllowedValuesForPrompt(allowedValuesRef.garmentType || allowedValuesRef.garment_type || [])}

⚠️ Use ONLY these exact values for kids full outfits.
` : 'Romper, frock, dungaree, jumpsuit, set'}

📍 SLEEVE LENGTH:
${allowedValuesRef.sleeveLength || allowedValuesRef.sleeve_length ? `
ALLOWED VALUES: ${formatAllowedValuesForPrompt(allowedValuesRef.sleeveLength || allowedValuesRef.sleeve_length || [])}

⚠️ Use exact enum from allowed list.
` : 'Sleeveless, short, long'}

📍 LENGTH:
${allowedValuesRef.length ? `
ALLOWED VALUES: ${formatAllowedValuesForPrompt(allowedValuesRef.length)}

⚠️ Use exact enum from list.
` : 'Overall garment length'}

TIER 2: STANDARD ATTRIBUTES

- COLOR: ${allowedValuesRef.color ? `Use from: ${formatAllowedValuesForPrompt(allowedValuesRef.color)}` : 'Fun colors, multi-color'}
- FIT: ${allowedValuesRef.fitType ? `Use from: ${formatAllowedValuesForPrompt(allowedValuesRef.fitType)}` : 'Comfortable, room for growth'}
- FABRIC: ${allowedValuesRef.fabric ? `Use from: ${formatAllowedValuesForPrompt(allowedValuesRef.fabric)}` : 'Soft, breathable, easy-care'}
- CLOSURE: ${allowedValuesRef.closureType ? `Use from: ${formatAllowedValuesForPrompt(allowedValuesRef.closureType)}` : 'Snaps, buttons, elastic'}
- OCCASION: ${allowedValuesRef.occasion ? `Use from: ${formatAllowedValuesForPrompt(allowedValuesRef.occasion)}` : 'Play, party, casual'}

 TIER 3: OPTIONAL ATTRIBUTES

- PRINT_THEME: ${allowedValuesRef.printTheme ? `Use from: ${formatAllowedValuesForPrompt(allowedValuesRef.printTheme)}` : 'Characters, animals, playful designs'}
- SAFETY: Child-safe materials, no choking hazards
- COMFORT: Soft seams, tagless, breathable
- FUNCTIONALITY: Easy dress/undress, diaper-friendly (infants)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
❌ SKIP THESE ATTRIBUTES (Not applicable to kids):
FORMAL_STYLING, SEXY_STYLE, BODY_CONSCIOUS, LOW_RISE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

⚠️ FINAL RULE: All values from database allowed list. No invented values. Use NULL if attribute not present.
`,
    
    focusAreas: [
      'Database enum validation',
      'Overall comfort and fit',
      'Easy wear features',
      'Fun prints and colors validation',
      'Child-safe construction',
      'Age-appropriate styling',
      'Durability for play'
    ],
    
    skipAttributes: [
      'formal_styling', 'sexy_style', 'body_conscious',
      'low_rise', 'formal_occasion'
    ]
  };
}
