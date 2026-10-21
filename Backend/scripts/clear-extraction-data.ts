import { PrismaClient } from '../src/generated/prisma';

const prisma = new PrismaClient();

async function clearExtractionData() {
    try {
        console.log('🗑️  Starting data cleanup...\n');

        // Delete in correct order due to foreign key constraints
        console.log('1. Deleting flat extraction results...');
        const deletedFlat = await prisma.extractionResultFlat.deleteMany({});
        console.log(`   ✅ Deleted ${deletedFlat.count} flat extraction results`);

        console.log('2. Deleting extraction jobs...');
        const deletedJobs = await prisma.extractionJob.deleteMany({});
        console.log(`   ✅ Deleted ${deletedJobs.count} extraction jobs`);

        console.log('\n✅ Data cleanup complete!');
        console.log('\nWhat was kept:');
        console.log('  ✓ User accounts');
        console.log('  ✓ Departments, SubDepartments, Categories');
        console.log('  ✓ Master Attributes and Allowed Values');

        console.log('\nWhat was deleted:');
        console.log('  ✗ All extraction jobs');
        console.log('  ✗ All flat extraction results');

    } catch (error) {
        console.error('❌ Error during cleanup:', error);
    } finally {
        await prisma.$disconnect();
    }
}

// Run the cleanup
clearExtractionData();
