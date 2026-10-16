import { PrismaClient } from '../src/generated/prisma';

const prisma = new PrismaClient();

async function main() {
    console.log('🗑️  Cleaning up existing hierarchy...');

    // CASCADE delete will handle SubDepartment and Category if we delete Department
    // But to be safe and thorough with any loose records:
    await prisma.categoryAttribute.deleteMany({});
    await prisma.extractionResultFlat.deleteMany({});
    await prisma.extractionJob.deleteMany({});
    await prisma.category.deleteMany({});
    await prisma.subDepartment.deleteMany({});
    await prisma.department.deleteMany({});

    console.log('✅ Hierarchy cleaned.');

    const departments = ['MEN', 'LADIES', 'KIDS'];
    const subDivisions = ['Upper', 'Lower', 'Sets', 'Denim'];

    for (const deptName of departments) {
        console.log(`🌱 Seeding Division: ${deptName}`);
        const dept = await prisma.department.create({
            data: {
                code: deptName,
                name: deptName,
                isActive: true
            }
        });

        for (const subName of subDivisions) {
            console.log(`   ↳ Sub-Division: ${subName}`);
            const sub = await prisma.subDepartment.create({
                data: {
                    departmentId: dept.id,
                    code: subName,
                    name: subName,
                    isActive: true
                }
            });

            // Create a "General" category for each sub-department to ensure
            // compatibility with any code that requires a Category ID
            await prisma.category.create({
                data: {
                    subDepartmentId: sub.id,
                    code: `${deptName}_${subName}_GENERAL`.toUpperCase(),
                    name: `${subName} Items`,
                    isActive: true
                }
            });
        }
    }

    console.log('🎉 Hierarchy re-seeding complete!');
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
