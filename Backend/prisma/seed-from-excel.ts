import { PrismaClient, AttributeType } from '../src/generated/prisma';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';

const execAsync = promisify(exec);
const prisma = new PrismaClient();

interface ParsedData {
  departments: Array<{
    code: string;
    name: string;
    full_name: string;
  }>;
  sub_divisions: Array<{
    department_code: string;
    code: string;
    name: string;
    full_name: string;
  }>;
  major_categories: Array<{
    sub_division_code: string;
    code: string;
    name: string;
    full_form?: string;
    merchandise_code?: string;
    merchandise_desc?: string;
    fabric_sheet: string;
  }>;
  attributes: Array<{
    key: string;
    label: string;
    full_form: string;
    category: string;
    ai_extractable: boolean;
    visible_from_distance: boolean;
    extraction_priority: number;
    allowed_values: Array<{
      short_form: string;
      full_form: string;
      aliases: string[];
    }>;
  }>;
  category_mappings: Array<{
    major_category: string;
    attribute: string;
  }>;
}

async function main() {
  console.log('Starting Excel Import to Database\n');

  try {
    // Step 1: Run Python parser to generate JSON file
    console.log('📊 Step 1/7: Parsing Excel file...');
    const pythonExec = 'D:/ai-extracto/ai-vlm-integration/.venv/Scripts/python.exe';
    const scriptPath = './scripts/parse-excel.py';
    const outputFile = '../parsed-data.json';
    
    // Run Python script and redirect output to file
    const { stderr } = await execAsync(`${pythonExec} ${scriptPath} > ${outputFile}`);
    
    // Log Python stderr (progress messages)
    if (stderr) {
      console.log(stderr);
    }
    
    // Read JSON from file
    console.log('📖 Reading parsed data from file...');
    const fileContent = fs.readFileSync(outputFile, 'utf-8');
    const data: ParsedData = JSON.parse(fileContent);
    console.log('✅ Excel parsed successfully\n');

    // Step 2: Clear existing data (optional - comment out to preserve)
    console.log('🗑️  Step 2/7: Clearing existing data...');
    await prisma.extractionJob.deleteMany({});
    await prisma.categoryAttribute.deleteMany({});
    await prisma.attributeAllowedValue.deleteMany({});
    await prisma.masterAttribute.deleteMany({});
    await prisma.category.deleteMany({});
    await prisma.subDepartment.deleteMany({});
    await prisma.department.deleteMany({});
    console.log('✅ Database cleared\n');

    // Step 3: Seed Departments (Batch)
    console.log('🏢 Step 3/7: Seeding Departments...');
    const departmentMap = new Map<string, number>();
    
    // Batch create all departments
    const deptData = data.departments.map((dept, idx) => ({
      code: dept.code,
      name: dept.name,
      description: dept.full_name,
      displayOrder: idx + 1,
    }));
    
    await prisma.department.createMany({ data: deptData });
    
    // Fetch created departments to build map
    const createdDepts = await prisma.department.findMany();
    createdDepts.forEach(dept => {
      departmentMap.set(dept.code, dept.id);
      console.log(`   ✓ ${dept.code} - ${dept.name}`);
    });
    console.log(`✅ Created ${departmentMap.size} departments\n`);

    // Step 4: Seed Sub-Divisions (Batch)
    console.log('📂 Step 4/7: Seeding Sub-Divisions...');
    const subDivisionMap = new Map<string, number>();
    
    // Prepare batch data
    const subDivData = data.sub_divisions
      .map((subDiv, idx) => {
        const deptId = departmentMap.get(subDiv.department_code);
        if (!deptId) {
          console.log(`   ⚠️  Skipping ${subDiv.code} - department not found`);
          return null;
        }
        return {
          departmentId: deptId,
          code: subDiv.code,
          name: subDiv.name,
          description: subDiv.full_name,
          displayOrder: idx + 1,
        };
      })
      .filter(Boolean) as any[];
    
    await prisma.subDepartment.createMany({ data: subDivData });
    
    // Fetch created sub-divisions to build map
    const createdSubDivs = await prisma.subDepartment.findMany();
    createdSubDivs.forEach(subDiv => {
      subDivisionMap.set(subDiv.code, subDiv.id);
      console.log(`   ✓ ${subDiv.code} - ${subDiv.name}`);
    });
    console.log(`✅ Created ${subDivisionMap.size} sub-divisions\n`);

    // Step 5: Seed Major Categories (Batch)
    console.log('📁 Step 5/7: Seeding Major Categories...');
    const categoryMap = new Map<string, number>();
    
    // Prepare batch data
    const catData = data.major_categories
      .map((cat, idx) => {
        const subDivId = subDivisionMap.get(cat.sub_division_code);
        if (!subDivId) {
          console.log(`   ⚠️  Skipping ${cat.code} - sub-division not found`);
          return null;
        }
        return {
          subDepartmentId: subDivId,
          code: cat.code,
          name: cat.name,
          fullForm: cat.full_form || null,
          merchandiseCode: cat.merchandise_code || null,
          merchandiseDesc: cat.merchandise_desc || null,
          fabricDivision: cat.fabric_sheet,
          displayOrder: idx + 1,
        };
      })
      .filter(Boolean) as any[];
    
    // Batch insert in chunks of 100
    const catChunkSize = 100;
    for (let i = 0; i < catData.length; i += catChunkSize) {
      const chunk = catData.slice(i, i + catChunkSize);
      await prisma.category.createMany({ data: chunk });
      console.log(`   ✓ Inserted categories ${i + 1} to ${Math.min(i + catChunkSize, catData.length)}`);
    }
    
    // Fetch created categories to build map
    const createdCats = await prisma.category.findMany();
    createdCats.forEach(cat => {
      categoryMap.set(cat.code, cat.id);
    });
    console.log(`✅ Created ${categoryMap.size} major categories\n`);

    // Step 6: Seed Master Attributes & Allowed Values (Batch)
    console.log('🎨 Step 6/7: Seeding Master Attributes...');
    const attributeMap = new Map<string, number>();
    
    // Batch create attributes
    const attrData = data.attributes.map((attr, idx) => {
      let attrType: AttributeType = AttributeType.TEXT;
      if (attr.allowed_values.length > 0 && attr.allowed_values.length < 100) {
        attrType = AttributeType.SELECT;
      }
      
      return {
        key: attr.key,
        label: attr.label,
        fullForm: attr.full_form,
        type: attrType,
        category: attr.category,
        aiExtractable: attr.ai_extractable,
        visibleFromDistance: attr.visible_from_distance,
        extractionPriority: attr.extraction_priority,
        confidenceThreshold: 0.70,
        displayOrder: idx + 1,
      };
    });
    
    await prisma.masterAttribute.createMany({ data: attrData });
    
    // Fetch created attributes
    const createdAttrs = await prisma.masterAttribute.findMany();
    createdAttrs.forEach(attr => {
      attributeMap.set(attr.key, attr.id);
    });
    console.log(`✅ Created ${attributeMap.size} attributes`);
    
    // Now batch insert allowed values
    console.log('   📝 Inserting allowed values...');
    const allAllowedValues: any[] = [];
    
    for (const attr of data.attributes) {
      const attrId = attributeMap.get(attr.key);
      if (!attrId || attr.allowed_values.length === 0) continue;
      
      attr.allowed_values.forEach((val, idx) => {
        allAllowedValues.push({
          attributeId: attrId,
          shortForm: val.short_form,
          fullForm: val.full_form,
          aliases: val.aliases,
          displayOrder: idx + 1,
        });
      });
    }
    
    // Insert in chunks of 500
    const valChunkSize = 500;
    for (let i = 0; i < allAllowedValues.length; i += valChunkSize) {
      const chunk = allAllowedValues.slice(i, i + valChunkSize);
      await prisma.attributeAllowedValue.createMany({ data: chunk });
      console.log(`   ✓ Inserted values ${i + 1} to ${Math.min(i + valChunkSize, allAllowedValues.length)}`);
    }
    
    const totalValues = await prisma.attributeAllowedValue.count();
    console.log(`✅ Created ${totalValues} allowed values\n`);

    // Step 7: Create Category-Attribute Mappings (Batch)
    console.log('🔗 Step 7/7: Creating Category-Attribute Mappings...');
    
    const mappingData = data.category_mappings
      .map((mapping, idx) => {
        const catId = categoryMap.get(mapping.major_category);
        const attrId = attributeMap.get(mapping.attribute);

        if (!catId || !attrId) {
          return null;
        }

        return {
          categoryId: catId,
          attributeId: attrId,
          isEnabled: true,
          displayOrder: idx + 1,
        };
      })
      .filter(Boolean) as any[];
    
    // Insert in chunks of 1000
    const mapChunkSize = 1000;
    for (let i = 0; i < mappingData.length; i += mapChunkSize) {
      const chunk = mappingData.slice(i, i + mapChunkSize);
      await prisma.categoryAttribute.createMany({ data: chunk });
      console.log(`   ✓ Inserted mappings ${i + 1} to ${Math.min(i + mapChunkSize, mappingData.length)}`);
    }
    
    const mappingCount = await prisma.categoryAttribute.count();
    console.log(`✅ Created ${mappingCount} category-attribute mappings\n`);

    // Final Summary
    console.log('📊 Final Database Summary:');
    const stats = {
      departments: await prisma.department.count(),
      subDivisions: await prisma.subDepartment.count(),
      categories: await prisma.category.count(),
      masterAttributes: await prisma.masterAttribute.count(),
      allowedValues: await prisma.attributeAllowedValue.count(),
      categoryMappings: await prisma.categoryAttribute.count(),
    };

    console.log(`   Departments: ${stats.departments}`);
    console.log(`   Sub-Divisions: ${stats.subDivisions}`);
    console.log(`   Major Categories: ${stats.categories}`);
    console.log(`   Master Attributes: ${stats.masterAttributes}`);
    console.log(`   Allowed Values: ${stats.allowedValues}`);
    console.log(`   Category-Attribute Mappings: ${stats.categoryMappings}`);

    console.log('\n✅ Excel import complete!\n');

    // Save summary to file
    const summary = {
      timestamp: new Date().toISOString(),
      stats,
      sample_hierarchy: {
        departments: data.departments.map(d => d.code),
        sample_sub_divisions: data.sub_divisions.slice(0, 10).map(s => s.code),
        sample_categories: data.major_categories.slice(0, 10).map(c => c.code),
      },
    };

    fs.writeFileSync(
      './database-import-summary.json',
      JSON.stringify(summary, null, 2)
    );
    console.log('📄 Summary saved to: database-import-summary.json');

  } catch (error) {
    console.error('\n❌ Import failed:', error);
    throw error;
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
