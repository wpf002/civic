import { prisma } from "./index.js";
import { seedFixture } from "./fixtures/2027-11-dallas.js";

const r = await seedFixture();
console.log(
  `fixture: ${r.candidates} candidates, ${r.positions} published positions ` +
    `(${r.silent} with no stated position or declined), ${r.sources} sources, ${r.questions} quiz questions`,
);
await prisma.$disconnect();
