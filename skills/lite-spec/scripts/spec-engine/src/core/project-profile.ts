import { access, readFile } from 'node:fs/promises';
import path from 'node:path';

export type ProjectType = 'frontend' | 'backend' | 'fullstack' | 'generic';

export type ProjectProfile = {
  type: ProjectType;
  signals: string[];
};

export async function detectProjectProfile(repo?: string): Promise<ProjectProfile> {
  if (!repo) {
    return { type: 'generic', signals: [] };
  }

  const signals: string[] = [];
  const packageJsonPath = path.join(repo, 'package.json');
  const requirementsPath = path.join(repo, 'requirements.txt');
  const pyprojectPath = path.join(repo, 'pyproject.toml');
  const pomPath = path.join(repo, 'pom.xml');
  const gradlePath = path.join(repo, 'build.gradle');
  const gradleKtsPath = path.join(repo, 'build.gradle.kts');
  const goModPath = path.join(repo, 'go.mod');
  const cargoPath = path.join(repo, 'Cargo.toml');
  const gemfilePath = path.join(repo, 'Gemfile');
  const composerPath = path.join(repo, 'composer.json');
  const dockerfilePath = path.join(repo, 'Dockerfile');
  const makefilePath = path.join(repo, 'Makefile');
  const csprojPath = path.join(repo, 'app.csproj');
  const slnPath = path.join(repo, 'app.sln');
  const javaMainPath = path.join(repo, 'src', 'main', 'java');
  const nodeServerPath = path.join(repo, 'server');
  const servicesPath = path.join(repo, 'services');
  const cmdPath = path.join(repo, 'cmd');
  const internalPath = path.join(repo, 'internal');
  const appDirPath = path.join(repo, 'app');
  const migrationsPath = path.join(repo, 'migrations');
  const sqlPath = path.join(repo, 'sql');
  const terraformPath = path.join(repo, 'terraform');
  const pagesPath = path.join(repo, 'src', 'pages');
  const srcAppPath = path.join(repo, 'src', 'app');
  const componentsPath = path.join(repo, 'src', 'components');
  const routesPath = path.join(repo, 'src', 'routes');

  const hasPackageJson = await exists(packageJsonPath);
  const hasRequirements = await exists(requirementsPath);
  const hasPyproject = await exists(pyprojectPath);
  const hasPom = await exists(pomPath);
  const hasGradle = await exists(gradlePath);
  const hasGradleKts = await exists(gradleKtsPath);
  const hasGoMod = await exists(goModPath);
  const hasCargo = await exists(cargoPath);
  const hasGemfile = await exists(gemfilePath);
  const hasComposer = await exists(composerPath);
  const hasDockerfile = await exists(dockerfilePath);
  const hasMakefile = await exists(makefilePath);
  const hasCsproj = await exists(csprojPath);
  const hasSln = await exists(slnPath);
  const hasJavaMain = await exists(javaMainPath);
  const hasNodeServerDir = await exists(nodeServerPath);
  const hasServices = await exists(servicesPath);
  const hasCmd = await exists(cmdPath);
  const hasInternal = await exists(internalPath);
  const hasAppDir = await exists(appDirPath);
  const hasMigrations = await exists(migrationsPath);
  const hasSql = await exists(sqlPath);
  const hasTerraform = await exists(terraformPath);
  const hasPages = await exists(pagesPath);
  const hasSrcApp = await exists(srcAppPath);
  const hasComponents = await exists(componentsPath);
  const hasRoutes = await exists(routesPath);

  let packageJson = '';
  if (hasPackageJson) {
    packageJson = await safeRead(packageJsonPath);
  }

  const frontendSignals = [
    hasPages ? 'src/pages' : '',
    hasSrcApp ? 'src/app' : '',
    hasComponents ? 'src/components' : '',
    hasRoutes ? 'src/routes' : '',
    /\breact\b|\bvue\b|\bnext\b|\bnuxt\b|\bvite\b|\bwebpack\b|\bsvelte\b/i.test(packageJson)
      ? 'frontend-package'
      : '',
  ].filter(Boolean);

  const backendSignals = [
    hasRequirements ? 'requirements.txt' : '',
    hasPyproject ? 'pyproject.toml' : '',
    hasPom ? 'pom.xml' : '',
    hasGradle ? 'build.gradle' : '',
    hasGradleKts ? 'build.gradle.kts' : '',
    hasGoMod ? 'go.mod' : '',
    hasCargo ? 'Cargo.toml' : '',
    hasGemfile ? 'Gemfile' : '',
    hasComposer ? 'composer.json' : '',
    hasDockerfile ? 'Dockerfile' : '',
    hasMakefile ? 'Makefile' : '',
    hasCsproj ? 'app.csproj' : '',
    hasSln ? 'app.sln' : '',
    hasJavaMain ? 'src/main/java' : '',
    hasNodeServerDir ? 'server' : '',
    hasServices ? 'services' : '',
    hasCmd ? 'cmd' : '',
    hasInternal ? 'internal' : '',
    hasAppDir ? 'app' : '',
    hasMigrations ? 'migrations' : '',
    hasSql ? 'sql' : '',
    hasTerraform ? 'terraform' : '',
    /\bnest\b|\bexpress\b|\bkoa\b|\bfastify\b|\bfastapi\b|\bdjango\b|\bflask\b|\bspring\b/i.test(
      packageJson,
    )
      ? 'backend-package'
      : '',
  ].filter(Boolean);

  signals.push(...frontendSignals, ...backendSignals);

  if (frontendSignals.length && backendSignals.length) {
    return { type: 'fullstack', signals };
  }
  if (frontendSignals.length) {
    return { type: 'frontend', signals };
  }
  if (backendSignals.length) {
    return { type: 'backend', signals };
  }

  return { type: 'generic', signals };
}

async function exists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function safeRead(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, 'utf8');
  } catch {
    return '';
  }
}
