// scripts/seed-marketplace.mjs — seed sample marketplace items for testing.
//
// Usage: node scripts/seed-marketplace.mjs

import { createClaimItem } from '../api/_lib/marketplace.js';

const SAMPLE_ITEMS = [
  // Logos
  {
    type: 'logo',
    title: 'Neon Wave Logo Pack',
    description: 'Cyberpunk-inspired neon wave logos perfect for music videos and streams.',
    creatorType: 'motion_designer',
    media: [],
    quantity: 5,
    maxQuantity: 10,
    lifespanSeconds: 90 * 24 * 60 * 60, // 90 days
  },
  {
    type: 'logo',
    title: 'Minimalist Brand Marks',
    description: 'Clean, minimal logo designs for creators and brands.',
    creatorType: 'graphics_designer',
    media: [],
    quantity: 8,
    maxQuantity: 15,
    lifespanSeconds: 90 * 24 * 60 * 60,
  },
  // Images
  {
    type: 'image',
    title: 'Abstract Texture Collection',
    description: 'High-resolution abstract textures for video overlays and backgrounds.',
    creatorType: 'graphics_designer',
    media: [],
    quantity: 12,
    maxQuantity: 20,
    lifespanSeconds: 90 * 24 * 60 * 60,
  },
  {
    type: 'image',
    title: 'Retro Film Stills',
    description: 'Vintage film-style stills for that nostalgic aesthetic.',
    creatorType: 'creator',
    media: [],
    quantity: 6,
    maxQuantity: 12,
    lifespanSeconds: 90 * 24 * 60 * 60,
  },
  // Clips (with short lifespans as per spec: 90 seconds to 9 minutes)
  {
    type: 'clip',
    title: 'Glitch Transition Pack',
    description: 'Digital glitch transitions for edit cutting. 1080p ProRes.',
    creatorType: 'motion_designer',
    media: [],
    quantity: 3,
    maxQuantity: 5,
    lifespanSeconds: 5 * 60, // 5 minutes - short lifespan!
  },
  {
    type: 'clip',
    title: 'Liquid Motion Loops',
    description: 'Seamless liquid motion backgrounds. 4K 60fps.',
    creatorType: 'motion_designer',
    media: [],
    quantity: 4,
    maxQuantity: 8,
    lifespanSeconds: 9 * 60, // 9 minutes - max clip lifespan
  },
  {
    type: 'clip',
    title: 'Particle Explosion FX',
    description: 'High-impact particle explosion overlays.',
    creatorType: 'motion_designer',
    media: [],
    quantity: 2,
    maxQuantity: 6,
    lifespanSeconds: 3 * 60, // 3 minutes
  },
  // Music Clips
  {
    type: 'music_clip',
    title: 'Epic Orchestral Stingers',
    description: 'Dramatic orchestral stingers for video reveals.',
    creatorType: 'creator',
    media: [],
    quantity: 10,
    maxQuantity: 25,
    lifespanSeconds: 90 * 24 * 60 * 60,
  },
  {
    type: 'music_clip',
    title: 'Lo-Fi Beat Collection',
    description: 'Chill lo-fi beats for streams and content creation.',
    creatorType: 'creator',
    media: [],
    quantity: 15,
    maxQuantity: 30,
    lifespanSeconds: 90 * 24 * 60 * 60,
  },
  {
    type: 'music_clip',
    title: 'Electronic Pulse Loops',
    description: 'Pulsing electronic loops for tech and gaming content.',
    creatorType: 'creator',
    media: [],
    quantity: 8,
    maxQuantity: 15,
    lifespanSeconds: 90 * 24 * 60 * 60,
  },
];

async function seed() {
  console.log('Seeding marketplace items...');
  let created = 0;
  for (const item of SAMPLE_ITEMS) {
    try {
      const createdItem = await createClaimItem(item);
      console.log(`✓ Created: ${createdItem.title} (${createdItem.type}) - ${createdItem.quantity}/${createdItem.maxQuantity} available`);
      created++;
    } catch (e) {
      console.error(`✗ Failed to create ${item.title}: ${e.message}`);
    }
  }
  console.log(`\nSeeded ${created} marketplace items.`);
}

seed().catch(console.error);
