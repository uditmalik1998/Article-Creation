import { PrismaClient } from '../src/generated/prisma';

const prisma = new PrismaClient();

async function main() {
    console.log('🗑️  Deleting all Sub-Divisions and dependent data...');

    // Delete dependent data first to avoid foreign key constraints
    console.log(' - Deleting Category Attributes...');
    await prisma.categoryAttribute.deleteMany({});

    console.log(' - Deleting Extraction Results (Flat)...');
    await prisma.extractionResultFlat.deleteMany({});

    console.log(' - Deleting Extraction Jobs...');
    await prisma.extractionJob.deleteMany({});

    console.log(' - Deleting Categories...');
    await prisma.category.deleteMany({});

    console.log(' - Deleting Sub-Departments (Sub-Divisions)...');
    const deleted = await prisma.subDepartment.deleteMany({});

    console.log(`✅ Deleted ${deleted.count} Sub-Divisions.`);
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
