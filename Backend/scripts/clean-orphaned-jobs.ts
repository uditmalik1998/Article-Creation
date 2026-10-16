import { PrismaClient } from '../src/generated/prisma';

const prisma = new PrismaClient();

async function cleanOrphanedJobs() {
    try {
        console.log('🧹 Cleaning orphaned extraction jobs...\n');

        // Get all job IDs from flat table
        const flatJobs = await prisma.extractionResultFlat.findMany({
            select: { jobId: true }
        });
        const validJobIds = new Set(flatJobs.map(j => j.jobId));

        console.log(`Valid jobs (in flat table): ${validJobIds.size}`);

        // Find orphaned jobs (jobs not in flat table)
        const allJobs = await prisma.extractionJob.findMany({
            select: { id: true, status: true, createdAt: true }
        });

        const orphanedJobs = allJobs.filter(job => !validJobIds.has(job.id));

        console.log(`Total jobs: ${allJobs.length}`);
        console.log(`Orphaned jobs: ${orphanedJobs.length}\n`);

        if (orphanedJobs.length === 0) {
            console.log('✅ No orphaned jobs found!');
            return;
        }

        console.log('Orphaned jobs to delete:');
        orphanedJobs.forEach((job, i) => {
            console.log(`${i + 1}. ${job.id} - ${job.status} - ${new Date(job.createdAt).toLocaleString()}`);
        });

        console.log('\n🗑️  Deleting orphaned jobs...');

        // Delete orphaned jobs
        const deletedJobs = await prisma.extractionJob.deleteMany({
            where: {
                id: { in: orphanedJobs.map(j => j.id) }
            }
        });
        console.log(`   Deleted ${deletedJobs.count} orphaned extraction jobs`);

        console.log('\n✅ Cleanup complete!');

    } catch (error) {
        console.error('❌ Error:', error);
    } finally {
        await prisma.$disconnect();
    }
}

cleanOrphanedJobs();
