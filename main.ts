import {
  Pool,
  serve,
  verifyJwt,
} from './deps.ts';

const JWT_CONFIG = {
  secret: Deno.env.get("API_JWT_SECRET") || '',
  algo: Deno.env.get("API_JWT_ALGORITHM") || 'none',
};

const DB_CONFIG = {
  user: Deno.env.get("DATABASE_USERNAME"),
  password: Deno.env.get("DATABASE_PASSWORD"),
  database: Deno.env.get("DATABASE_NAME"),
  hostname: Deno.env.get("DATABASE_HOST"),
  port: Deno.env.get("DATABASE_PORT"),
};
const POOL_CONNECTIONS = 5;

const pool = new Pool(
  DB_CONFIG,
  POOL_CONNECTIONS,
);

async function runQuery<T extends Record<string, unknown>>(text: string, args: unknown[] = []) {
  const client = await pool.connect();

  const result = await client.queryObject<T>({
    text,
    args,
  });

  client.release();

  return result;
}

function queryBy(ids: number[]) {
  return async <T extends Record<string, unknown>>(table: string) => {
    const { rows } = await runQuery<T>(
      `select * from ${table} where resume_id = ANY($1::int[])`,
      [
        ids,
      ],
    );

    return rows;
  }
}

async function buildResponse(): Promise<string> {
  // console.time('query');
  const { rows: resumes } = await runQuery(`select * from resumes`);
  const ids = resumes.map(({ id }) => id as number);
  const idQuery = queryBy(ids);
  const [
    educations,
    workExperiences,
    computerSkills,
    skills,
    languages,
    awards,
  ] = await Promise.all([
    idQuery('resume_educations'),
    idQuery('resume_work_experiences'),
    idQuery('resume_computer_skills'),
    idQuery('resume_skills'),
    idQuery('resume_languages'),
    idQuery('resume_awards'),
  ]);
  // console.timeEnd('query');

  // console.time('serialization');
  const response = {
    resumes: resumes.map((u) => ({
      ...u,
      user_id: String(u.user_id),
    })),
    educations,
    workExperiences,
    computerSkills,
    skills,
    languages,
    awards,
  };

  const payload = JSON.stringify(response);
  // console.timeEnd('serialization');

  return payload;
}

const server = serve({
  port: 8080,
});

const headers = new Headers({
  'Content-Type': 'application/json',
  'X-Powered-By': 'ligma',
});

const AUTH_JWT_HEADER = 'jwt ';

for await (const request of server) {
  const auth = request.headers.get('Authorization');

  if (!auth || !auth.startsWith(AUTH_JWT_HEADER)) {
    request.respond({
      status: 403,
      headers,
      body: JSON.stringify({
        error: "No Authorization header",
      }),
    });

    continue;
  }

  const authJwt = auth.substr(AUTH_JWT_HEADER.length);
  try {
    await verifyJwt(authJwt, JWT_CONFIG.secret, JWT_CONFIG.algo as any);
  } catch {
    request.respond({
      status: 403,
      headers,
      body: JSON.stringify({
        error: "Invalid JWT in Authorization header",
      }),
    });

    continue;
  }

  request.respond({
    status: 200,
    headers,
    body: await buildResponse(),
  });
}
