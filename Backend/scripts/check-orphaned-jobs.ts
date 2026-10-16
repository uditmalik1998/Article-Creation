import { PrismaClient } from '../src/generated/prisma';

const prisma = new PrismaClient();

async function checkData() {
    try {
        console.log('📊 Checking database counts...\n');

        const [jobsCount, flatCount] = await Promise.all([
            prisma.extractionJob.count(),
            prisma.extractionResultFlat.count(),
        ]);

        console.log(`Extraction Jobs: ${jobsCount}`);
        console.log(`Flat Results: ${flatCount}\n`);

        if (jobsCount > flatCount) {
            console.log('⚠️  There are orphaned extraction jobs!');
            console.log(`   ${jobsCount - flatCount} jobs exist without flat table entries\n`);

            // Show the orphaned jobs
            const jobs = await prisma.extractionJob.findMany({
                select: {
                    id: true,
                    status: true,
                    createdAt: true,
                    imageUrl: true
                },
                orderBy: { createdAt: 'desc' }
            });

            console.log('All extraction jobs:');
            jobs.forEach((job, i) => {
                console.log(`${i + 1}. ${job.id} - ${job.status} - ${new Date(job.createdAt).toLocaleString()}`);
            });
        } else {
            console.log('✅ Data is consistent!');
        }

    } catch (error) {
        console.error('❌ Error:', error);
    } finally {
        await prisma.$disconnect();
    }
}

checkData();
