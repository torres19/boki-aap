import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import bcrypt from 'bcrypt';
import session from 'express-session';
import pg from 'pg';
import connectPgSimple from 'connect-pg-simple';
import Stripe from 'stripe'; 

// ★★★ 型定義の拡張 ★★★
// express-sessionの型定義を拡張して、userプロパティを認識させる
declare module 'express-session' {
  interface SessionData {
    user?: {
      id: number;
      username: string;
      role: 'student' | 'teacher' | 'admin';
    };
  }
}

// --- 初期設定 ---
const app = express();
const port = process.env.PORT || 3000;
const saltRounds = 10;
const Pool = pg.Pool;
const pgPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});
const pgSession = connectPgSimple(session);

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
    apiVersion: '2024-06-20', // ★★★ バージョンを更新 ★★★
});

const STRIPE_PRICE_ID = process.env.STRIPE_PRICE_ID || 'price_YOUR_PRICE_ID';

// --- エラーハンドリング ---
const handleDbError = (res: express.Response, error: any, context: string) => {
    console.error(`Database error in ${context}:`, error);
    if (error.code === 'ECONNRESET' || error.code === 'EPIPE' || error.message.includes('timeout')) {
        return res.status(503).json({ error: 'データベース接続に失敗しました。時間をおいて再度お試しください。' });
    }
    return res.status(500).json({ error: 'サーバーで不明なエラーが発生しました。' });
};


// --- ミドルウェア設定 ---
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), handleStripeWebhook);

app.use(express.static('public'));
app.use(express.json());
app.use(session({
    store: new pgSession({
        pool: pgPool,
        tableName: 'user_sessions'
    }),
    secret: process.env.SESSION_SECRET || 'dev-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

// --- 認証ミドルウェア ---
const requireLogin = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (req.session.user) {
        next();
    } else {
        res.status(401).json({ error: 'ログインが必要です。' });
    }
};

const requireTeacher = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (req.session.user && (req.session.user.role === 'teacher' || req.session.user.role === 'admin')) {
        next();
    } else {
        res.status(403).json({ error: 'この操作を行う権限がありません。' });
    }
};

const requireAdmin = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (req.session.user && req.session.user.role === 'admin') {
        next();
    } else {
        res.status(403).json({ error: '管理者権限が必要です。' });
    }
};


// --- アチーブメントの定義 ---
const ACHIEVEMENTS = {
    FIRST_STEP: { id: 'FIRST_STEP', name: '最初の一歩', description: '初めて問題に正解した', icon: '🦶' },
    TEN_ATTEMPTS: { id: 'TEN_ATTEMPTS', name: '挑戦者', description: '累計10問に解答した', icon: '🔥' },
    FIFTY_ATTEMPTS: { id: 'FIFTY_ATTEMPTS', name: '努力家', description: '累計50問に解答した', icon: '💪' },
    PERFECT_QUIZ: { id: 'PERFECT_QUIZ', name: 'パーフェクト', description: '3問以上のクイズで全問正解した', icon: '🎯' },
    FAVORITE_MASTER: { id: 'FAVORITE_MASTER', name: 'お気に入りマスター', description: 'お気に入りを5個登録した', icon: '⭐' },
};

// --- データベース初期化 ---
async function initializeDb() {
    const client = await pgPool.connect();
    try {
        await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;`);
        await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_status TEXT DEFAULT 'free';`);
        await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;`);
        console.log('データベーステーブルの準備ができました。');
    } catch(err) {
        console.error("DB初期化エラー:", err);
    }
    finally {
        client.release();
    }
}

// --- アチーブメント判定ロジック ---
async function checkAndAwardAchievements(userId: number, quizContext: { is_correct: boolean, questionsInSession: number, score: number}) {
    const client = await pgPool.connect();
    try {
        const newlyUnlocked = [];
        const userStatsRes = await client.query(
            `SELECT
                (SELECT COUNT(*) FROM attempts WHERE user_id = $1) as total_attempts,
                (SELECT ARRAY_AGG(achievement_id) FROM user_achievements WHERE user_id = $1) as unlocked_ids
            FROM users WHERE id = $1;`,
            [userId]
        );
        const stats = userStatsRes.rows[0];
        const unlockedIds: string[] = stats.unlocked_ids || [];

        if (!unlockedIds.includes(ACHIEVEMENTS.FIRST_STEP.id) && quizContext.is_correct) { newlyUnlocked.push(ACHIEVEMENTS.FIRST_STEP); }
        if (!unlockedIds.includes(ACHIEVEMENTS.TEN_ATTEMPTS.id) && stats.total_attempts >= 10) { newlyUnlocked.push(ACHIEVEMENTS.TEN_ATTEMPTS); }
        if (!unlockedIds.includes(ACHIEVEMENTS.FIFTY_ATTEMPTS.id) && stats.total_attempts >= 50) { newlyUnlocked.push(ACHIEVEMENTS.FIFTY_ATTEMPTS); }
        if (!unlockedIds.includes(ACHIEVEMENTS.PERFECT_QUIZ.id) && quizContext.questionsInSession >= 3 && quizContext.score === quizContext.questionsInSession) { newlyUnlocked.push(ACHIEVEMENTS.PERFECT_QUIZ); }
        const favCountRes = await client.query('SELECT COUNT(*) as count FROM user_quiz_favorites WHERE user_id = $1', [userId]);
        if (!unlockedIds.includes(ACHIEVEMENTS.FAVORITE_MASTER.id) && favCountRes.rows[0].count >= 5) { newlyUnlocked.push(ACHIEVEMENTS.FAVORITE_MASTER); }

        for (const ach of newlyUnlocked) {
            await client.query('INSERT INTO user_achievements (user_id, achievement_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [userId, ach.id]);
        }
        return newlyUnlocked;
    } finally {
        client.release();
    }
}

// --- Stripe Webhookハンドラー ---
async function handleStripeWebhook(req: express.Request, res: express.Response) {
    const sig = req.headers['stripe-signature'] as string;
    let event: Stripe.Event;

    try {
        event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET!);
    } catch (err: any) {
        console.error(`Webhook Error: ${err.message}`);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    const dataObject = event.data.object as any;
    
    let customerId;
    if (event.type === 'checkout.session.completed') {
        customerId = dataObject.customer;
    } else if (dataObject.customer) {
        customerId = dataObject.customer;
    }
     
    if (!customerId) {
        console.error('Webhook received without customer ID.');
        return res.status(400).send('Webhook received without customer ID.');
    }
    
    try {
        switch (event.type) {
            case 'checkout.session.completed': {
                const session = event.data.object as Stripe.Checkout.Session;
                if (session.mode === 'subscription' && session.subscription) {
                    const subscription = await stripe.subscriptions.retrieve(session.subscription as string);
                    const newStatus = subscription.status === 'active' || subscription.status === 'trialing' ? 'active' : 'free';
                    await pgPool.query(
                        `UPDATE users SET subscription_status = $1, stripe_customer_id = $2 WHERE stripe_customer_id = $3`,
                        [newStatus, customerId, customerId]
                    );
                    console.log(`[Stripe Hook] User for customer ${customerId} subscription set to ${newStatus}`);
                }
                break;
            }
            case 'customer.subscription.updated':
            case 'customer.subscription.deleted': {
                const subscription = event.data.object as Stripe.Subscription;
                const newStatus = subscription.status === 'active' || subscription.status === 'trialing' ? 'active' : 'free';
                
                 await pgPool.query(
                    `UPDATE users SET subscription_status = $1 WHERE stripe_customer_id = $2`,
                    [newStatus, customerId]
                );
                console.log(`[Stripe Hook] User for customer ${customerId} subscription updated to ${newStatus}`);
                break;
            }
            default:
                console.log(`Unhandled event type ${event.type}`);
        }
        res.json({ received: true });
    } catch (error) {
        return handleDbError(res, error, 'Stripe Webhook DB update');
    }
}

// --- APIエンドポイント ---
app.post('/api/register', async (req: express.Request, res: express.Response) => {
    const { username, password } = req.body;
    const role = 'student';
    if (!username || !password || !role) { return res.status(400).json({ error: 'すべてのフィールドを入力してください。' }); }
    try {
        const hashedPassword = await bcrypt.hash(password, saltRounds);
        await pgPool.query("INSERT INTO users (username, password, role) VALUES ($1, $2, $3)", [username, hashedPassword, role]);
        res.status(201).json({ message: '登録が完了しました。' });
    } catch (err: any) {
        if (err.code === '23505') { return res.status(409).json({ error: 'このユーザー名は既に使用されています。' }); }
        return handleDbError(res, err, 'Register');
    }
});

app.post('/api/login', async (req: express.Request, res: express.Response) => {
    const { username, password } = req.body;
    try {
        const result = await pgPool.query("SELECT * FROM users WHERE username = $1", [username]);
        const user = result.rows[0];
        if (!user) {
            return res.status(401).json({ error: 'ユーザー名またはパスワードが違います。' });
        }
        const match = await bcrypt.compare(password, user.password);
        if (match) {
            req.session.user = { id: user.id, username: user.username, role: user.role };
            await pgPool.query('INSERT INTO login_history (user_id) VALUES ($1)', [user.id]);
            
            req.session.save((err: any) => {
                if (err) {
                    console.error("Session save error:", err);
                    return res.status(500).json({ error: 'セッションの保存に失敗しました。' });
                }
                res.json({ user: req.session.user });
            });
        } else {
            res.status(401).json({ error: 'ユーザー名またはパスワードが違います。' });
        }
    } catch (err) {
        return handleDbError(res, err, 'Login');
    }
});

app.post('/api/logout', (req: express.Request, res: express.Response) => {
    req.session.destroy(err => {
        if (err) { return res.status(500).json({ error: 'ログアウトに失敗しました。' }); }
        res.clearCookie('connect.sid');
        res.status(204).send();
    });
});
app.get('/api/session', (req: express.Request, res: express.Response) => {
    res.json({ user: req.session.user || null });
});

app.get('/api/users', requireAdmin, async (req: express.Request, res: express.Response) => {
    try {
        const result = await pgPool.query("SELECT id, username, role, subscription_status FROM users ORDER BY id");
        res.json(result.rows);
    } catch (err) {
        return handleDbError(res, err, 'Get Users');
    }
});

app.put('/api/users/:id/role', requireAdmin, async (req: express.Request, res: express.Response) => {
    const { id } = req.params;
    const { role } = req.body;
    if (!['student', 'teacher', 'admin'].includes(role)) {
        return res.status(400).json({ error: '無効な役割です。' });
    }
    try {
        await pgPool.query("UPDATE users SET role = $1 WHERE id = $2", [role, id]);
        res.json({ message: '役割が更新されました。' });
    } catch(err) {
        return handleDbError(res, err, 'Update User Role');
    }
});

app.post('/api/users/create_special', requireAdmin, async (req: express.Request, res: express.Response) => {
    const { username, password, role } = req.body;
    if (!username || !password || !role) { return res.status(400).json({ error: 'すべてのフィールドを入力してください。' }); }
     try {
        const hashedPassword = await bcrypt.hash(password, saltRounds);
        await pgPool.query(
            "INSERT INTO users (username, password, role, subscription_status) VALUES ($1, $2, $3, 'active')", 
            [username, hashedPassword, role]
        );
        res.status(201).json({ message: '特別アカウントが作成されました。' });
    } catch (err: any) {
        if (err.code === '23505') { return res.status(409).json({ error: 'このユーザー名は既に使用されています。' }); }
        return handleDbError(res, err, 'Create Special User');
    }
});

app.delete('/api/users/:id', requireAdmin, async (req: express.Request, res: express.Response) => {
    const { id } = req.params;
    if (req.session.user!.id === parseInt(id, 10)) {
        return res.status(400).json({ error: '自分自身のアカウントは削除できません。' });
    }
    try {
        await pgPool.query("DELETE FROM users WHERE id = $1", [id]);
        res.status(204).send();
    } catch (err) {
        return handleDbError(res, err, 'Delete User');
    }
});

app.get('/api/stripe/config', requireLogin, (req: express.Request, res: express.Response) => {
    res.json({ publishableKey: process.env.STRIPE_PUBLISHABLE_KEY });
});

app.post('/api/subscription/create-checkout-session', requireLogin, async (req: express.Request, res: express.Response) => {
    const userId = req.session.user!.id;
    try {
        const userRes = await pgPool.query("SELECT username, stripe_customer_id FROM users WHERE id = $1", [userId]);
        const user = userRes.rows[0];
        
        let customerId = user.stripe_customer_id;
        if (!customerId) {
            const customer = await stripe.customers.create({
                metadata: { userId: userId.toString() },
            });
            customerId = customer.id;
            await pgPool.query("UPDATE users SET stripe_customer_id = $1 WHERE id = $2", [customerId, userId]);
        }
        
        const session = await stripe.checkout.sessions.create({
            mode: 'subscription',
            customer: customerId,
            payment_method_types: ['card'],
            line_items: [
                {
                    price: STRIPE_PRICE_ID,
                    quantity: 1,
                },
            ],
            success_url: `${req.protocol}://${req.get('host')}/?payment_status=success`,
            cancel_url: `${req.protocol}://${req.get('host')}/?payment_status=canceled`,
        });

        res.json({ sessionId: session.id });
        
    } catch (error) {
        console.error('Error creating checkout session:', error);
        return handleDbError(res, error, 'Create Checkout Session');
    }
});


app.get('/api/subgenres/:genre/:subgenre/questions', requireLogin, async (req: express.Request, res: express.Response) => {
    const { genre, subgenre } = req.params;
    const userId = req.session.user!.id;
    
    try {
        const userStatusRes = await pgPool.query("SELECT subscription_status, role FROM users WHERE id = $1", [userId]);
        const { subscription_status, role } = userStatusRes.rows[0];
        const isSubscribed = subscription_status === 'active' || role === 'admin' || role === 'teacher';
        
        if (!isSubscribed && (genre === '日商簿記2級' || genre === '日商簿記1級')) {
            return res.status(403).json({ error: 'このジャンルを解くにはサブスクリプションが必要です。' });
        }

        const query = `
            WITH RecentAttempts AS (
                SELECT
                    quiz_id, is_correct, timestamp,
                    ROW_NUMBER() OVER(PARTITION BY quiz_id ORDER BY timestamp DESC) as rn
                FROM attempts
                WHERE user_id = $1
            )
            SELECT
                q.id, q.question,
                MAX(ra.timestamp) as latest_attempt_timestamp,
                ARRAY_AGG(ra.is_correct ORDER BY ra.timestamp DESC) FILTER (WHERE ra.rn <= 3) as recent_results,
                CASE WHEN f.quiz_id IS NOT NULL THEN TRUE ELSE FALSE END as is_favorite
            FROM quizzes q
            LEFT JOIN RecentAttempts ra ON q.id = ra.quiz_id
            LEFT JOIN user_quiz_favorites f ON q.id = f.quiz_id AND f.user_id = $1
            WHERE q.genre = $2 AND q.subgenre = $3
            GROUP BY q.id, f.quiz_id
            ORDER BY q.id;
        `;
        const result = await pgPool.query(query, [userId, genre, subgenre]);
        res.json(result.rows);
    } catch (err) {
        return handleDbError(res, err, 'Get Questions');
    }
});

app.post('/api/quizzes/:quizId/toggle_favorite', requireLogin, async (req: express.Request, res: express.Response) => {
    const { quizId } = req.params;
    const userId = req.session.user!.id;
    try {
        const isFavoriteResult = await pgPool.query("SELECT 1 FROM user_quiz_favorites WHERE user_id = $1 AND quiz_id = $2", [userId, quizId]);
        if (isFavoriteResult.rows.length > 0) {
            await pgPool.query("DELETE FROM user_quiz_favorites WHERE user_id = $1 AND quiz_id = $2", [userId, quizId]);
            const newlyUnlocked = await checkAndAwardAchievements(userId, {is_correct: false, questionsInSession: 0, score: 0});
            res.json({ is_favorite: false, newlyUnlocked });
        } else {
            await pgPool.query("INSERT INTO user_quiz_favorites (user_id, quiz_id) VALUES ($1, $2)", [userId, quizId]);
            const newlyUnlocked = await checkAndAwardAchievements(userId, {is_correct: false, questionsInSession: 0, score: 0});
            res.json({ is_favorite: true, newlyUnlocked });
        }
    } catch (err) {
        return handleDbError(res, err, 'Toggle Favorite');
    }
});

app.get('/api/quizzes', requireLogin, async (req: express.Request, res: express.Response) => {
    try {
        const result = await pgPool.query(`
            SELECT 
                q.id, q.genre, q.subgenre, q.question, q.answer, q.explanation
            FROM quizzes q
            ORDER BY q.genre, q.subgenre, q.id
        `);
        const attemptsRes = await pgPool.query(`
            SELECT 
                quiz_id,
                COUNT(*) as total_attempts,
                SUM(CASE WHEN is_correct = TRUE THEN 1 ELSE 0 END) as correct_attempts
            FROM attempts 
            WHERE user_id = $1
            GROUP BY quiz_id
        `, [req.session.user!.id]);

        const attemptsMap = new Map(attemptsRes.rows.map((a: any) => [a.quiz_id, a]));

        const quizzesWithAttempts = result.rows.map(q => {
            const attempts = attemptsMap.get(q.id);
            return {
                ...q,
                total_attempts: attempts ? parseInt(attempts.total_attempts, 10) : 0,
                correct_attempts: attempts ? parseInt(attempts.correct_attempts, 10) : 0
            };
        });
        res.json(quizzesWithAttempts);
    } catch (err) {
        return handleDbError(res, err, 'Get Quizzes');
    }
});
app.post('/api/quizzes', requireTeacher, async (req: express.Request, res: express.Response) => {
    const { genre, subgenre, question, answer, explanation } = req.body;
    if (!genre || !subgenre || !question || !answer) { return res.status(400).json({ error: 'ジャンル、小ジャンル、問題文、答えは必須です。' }); }
    try {
        const result = await pgPool.query("INSERT INTO quizzes (genre, subgenre, question, answer, explanation) VALUES ($1, $2, $3, $4, $5) RETURNING id", [genre, subgenre, question, answer, explanation || null]);
        res.status(201).json({ id: result.rows[0].id });
    } catch (err) {
        return handleDbError(res, err, 'Create Quiz');
    }
});
app.get('/api/quizzes/:id', requireTeacher, async (req: express.Request, res: express.Response) => {
    const { id } = req.params;
    try {
        const result = await pgPool.query("SELECT * FROM quizzes WHERE id = $1", [id]);
        if (result.rows.length === 0) { return res.status(404).json({ error: '問題が見つかりません。' }); }
        res.json(result.rows[0]);
    } catch (err) {
        return handleDbError(res, err, 'Get Quiz By Id');
    }
});
app.put('/api/quizzes/:id', requireTeacher, async (req: express.Request, res: express.Response) => {
    const { id } = req.params;
    const { genre, subgenre, question, answer, explanation } = req.body;
    if (!genre || !subgenre || !question || !answer) { return res.status(400).json({ error: 'ジャンル、小ジャンル、問題文、答えは必須です。' }); }
    try {
        const result = await pgPool.query("UPDATE quizzes SET genre = $1, subgenre = $2, question = $3, answer = $4, explanation = $5 WHERE id = $6", [genre, subgenre, question, answer, explanation || null, id]);
        if (result.rowCount === 0) { return res.status(404).json({ error: '問題が見つかりません。' }); }
        res.json({ message: '問題を更新しました。' });
    } catch (err) {
        return handleDbError(res, err, 'Update Quiz');
    }
});
app.delete('/api/quizzes/:id', requireTeacher, async (req: express.Request, res: express.Response) => {
    const { id } = req.params;
    try {
        const result = await pgPool.query("DELETE FROM quizzes WHERE id = $1", [id]);
        if (result.rowCount === 0) { return res.status(404).json({ error: '問題が見つかりません。' }); }
        res.status(204).send();
    } catch (err) {
        return handleDbError(res, err, 'Delete Quiz');
    }
});

app.post('/api/submit_answer', requireLogin, async (req: express.Request, res: express.Response) => {
    const { quiz_id, user_answer, questionsInSession, score } = req.body;
    const user_id = req.session.user!.id;
    if (!quiz_id || !user_answer) { return res.status(400).json({ error: '不正なリクエストです。' }); }
    try {
        const quizResult = await pgPool.query('SELECT answer, explanation FROM quizzes WHERE id = $1', [quiz_id]);
        if (quizResult.rows.length === 0) { return res.status(404).json({ error: '問題が見つかりません。' }); }
        const { answer: correct_answer, explanation } = quizResult.rows[0];
        const checkEntries = (arr1: any[], arr2: any[]) => {
            if (!arr1 || !arr2 || arr1.length !== arr2.length) return false;
            const s1 = arr1.map(e => `${e.account}:${e.amount}`).sort().join(',');
            const s2 = arr2.map(e => `${e.account}:${e.amount}`).sort().join(',');
            return s1 === s2;
        };
        const totalUserDebit = user_answer.debits.reduce((sum: number, e: any) => sum + e.amount, 0);
        const totalUserCredit = user_answer.credits.reduce((sum: number, e: any) => sum + e.amount, 0);
        const is_correct = totalUserDebit > 0 && totalUserDebit === totalUserCredit && checkEntries(user_answer.debits, correct_answer.debits) && checkEntries(user_answer.credits, correct_answer.credits);
        
        await pgPool.query('INSERT INTO attempts (user_id, quiz_id, is_correct) VALUES ($1, $2, $3)', [user_id, quiz_id, is_correct]);
        
        const currentScore = is_correct ? score + 1 : score;
        const newlyUnlocked = await checkAndAwardAchievements(user_id, {is_correct, questionsInSession, score: currentScore});

        if (is_correct) {
            const xpPerCorrect = 10;
            const userRes = await pgPool.query('SELECT level, experience FROM users WHERE id = $1', [user_id]);
            let { level, experience } = userRes.rows[0];
            experience += xpPerCorrect;
            let xpForNextLevel = level * 100;
            while (experience >= xpForNextLevel) {
                experience -= xpForNextLevel;
                level++;
                xpForNextLevel = level * 100;
            }
            await pgPool.query('UPDATE users SET level = $1, experience = $2 WHERE id = $3', [level, experience, user_id]);
        }
        res.json({ is_correct, correct_answer, explanation, newlyUnlocked });
    } catch (err) {
        return handleDbError(res, err, 'Submit Answer');
    }
});
app.get('/api/profile', requireLogin, async (req: express.Request, res: express.Response) => {
    const userId = req.session.user!.id;
    try {
        const userRes = await pgPool.query("SELECT username, level, experience, subscription_status FROM users WHERE id = $1", [userId]);
        const statsRes = await pgPool.query(`SELECT COUNT(*) as total_attempts, SUM(CASE WHEN is_correct = TRUE THEN 1 ELSE 0 END) as correct_attempts FROM attempts WHERE user_id = $1`, [userId]);
        const user = userRes.rows[0];
        const stats = statsRes.rows[0];
        const successRate = (stats.total_attempts > 0) ? (stats.correct_attempts / stats.total_attempts) * 100 : 0;
        res.json({ ...user, xp_for_next_level: user.level * 100, total_attempts: parseInt(stats.total_attempts, 10), success_rate: successRate });
    } catch (err) {
        return handleDbError(res, err, 'Get Profile');
    }
});

app.get('/api/achievements', requireLogin, async (req: express.Request, res: express.Response) => {
    const userId = req.session.user!.id;
    try {
        const result = await pgPool.query(`
            SELECT
                a.id, a.name, a.description, a.icon,
                CASE WHEN ua.user_id IS NOT NULL THEN ua.unlocked_at ELSE NULL END as unlocked_at
            FROM achievements a
            LEFT JOIN user_achievements ua ON a.id = ua.achievement_id AND ua.user_id = $1
            ORDER BY a.id;
        `, [userId]);
        res.json(result.rows);
    } catch (err) {
        return handleDbError(res, err, 'Get Achievements');
    }
});

app.get('/api/analytics/by_student', requireTeacher, async (req: express.Request, res: express.Response) => {
    try {
        const result = await pgPool.query(`SELECT u.username, q.genre, q.subgenre, a.is_correct FROM attempts a JOIN users u ON a.user_id = u.id JOIN quizzes q ON a.quiz_id = q.id WHERE u.role = 'student'`);
        const analytics: any = {};
        result.rows.forEach((row: any) => {
            if (!analytics[row.username]) analytics[row.username] = { byGenre: {} };
            if (!analytics[row.username].byGenre[row.genre]) analytics[row.username].byGenre[row.genre] = {};
            if (!analytics[row.username].byGenre[row.genre][row.subgenre]) { analytics[row.username].byGenre[row.genre][row.subgenre] = { attempts: 0, corrects: 0 }; }
            analytics[row.username].byGenre[row.genre][row.subgenre].attempts++;
            if (row.is_correct) { analytics[row.username].byGenre[row.genre][row.subgenre].corrects++; }
        });
        res.json(analytics);
    } catch (err) {
        return handleDbError(res, err, 'Get Analytics By Student');
    }
});

app.get('/api/analytics/dashboard', requireTeacher, async (req: express.Request, res: express.Response) => {
    try {
        const summaryQuery = `
            SELECT
                (SELECT COUNT(*) FROM users WHERE role = 'student') as total_students,
                (SELECT COUNT(*) FROM users WHERE role = 'student' AND created_at >= NOW() - interval '28 days') as new_students_current,
                (SELECT COUNT(*) FROM users WHERE role = 'student' AND created_at < NOW() - interval '28 days' AND created_at >= NOW() - interval '56 days') as new_students_previous,
                
                (SELECT COUNT(DISTINCT user_id) FROM login_history WHERE login_timestamp >= NOW() - interval '3 days') as wau_current,
                (SELECT COUNT(DISTINCT user_id) FROM login_history WHERE login_timestamp < NOW() - interval '3 days' AND login_timestamp >= NOW() - interval '6 days') as wau_previous,

                COUNT(CASE WHEN a.timestamp >= NOW() - interval '28 days' THEN 1 END) as total_attempts_current,
                COUNT(CASE WHEN a.timestamp < NOW() - interval '28 days' AND a.timestamp >= NOW() - interval '56 days' THEN 1 END) as total_attempts_previous
            FROM attempts a
            JOIN users u ON a.user_id = u.id
            WHERE u.role = 'student';
        `;

        const mistakeRankingQuery = `
            SELECT
                q.id, q.question, q.genre, q.subgenre,
                COUNT(*) AS total_attempts,
                SUM(CASE WHEN a.is_correct = FALSE THEN 1 ELSE 0 END) as incorrect_attempts,
                (CAST(SUM(CASE WHEN a.is_correct = FALSE THEN 1 ELSE 0 END) AS FLOAT) / COUNT(*)) * 100 as mistake_rate
            FROM attempts a
            JOIN quizzes q ON a.quiz_id = q.id
            GROUP BY q.id, q.question, q.genre, q.subgenre
            HAVING COUNT(*) > 0
            ORDER BY incorrect_attempts DESC, mistake_rate DESC
            LIMIT 5;
        `;
        
        const studentGrowthQuery = `
            SELECT
                d.day::date,
                COUNT(u.id) as registered_students
            FROM generate_series(CURRENT_DATE - interval '29 days', CURRENT_DATE, '1 day') d(day)
            LEFT JOIN users u ON u.created_at::date = d.day::date AND u.role = 'student'
            GROUP BY d.day
            ORDER BY d.day;
        `;
        
        const dailyAttemptsQuery = `
            SELECT
                d.day::date,
                COUNT(a.id) as total_attempts
            FROM generate_series(CURRENT_DATE - interval '29 days', CURRENT_DATE, '1 day') d(day)
            LEFT JOIN attempts a ON a.timestamp::date = d.day::date
            GROUP BY d.day
            ORDER BY d.day;
        `;


        const [summaryRes, mistakeRankingRes, studentGrowthRes, dailyAttemptsRes] = await Promise.all([
            pgPool.query(summaryQuery),
            pgPool.query(mistakeRankingQuery),
            pgPool.query(studentGrowthQuery),
            pgPool.query(dailyAttemptsQuery)
        ]);
        
        const allStudentsRes = await pgPool.query("SELECT created_at FROM users WHERE role = 'student' ORDER BY created_at ASC");
        const cumulativeStudents = studentGrowthRes.rows.map((dayData: any) => {
            const day = new Date(dayData.day);
            day.setHours(23, 59, 59, 999);
            const count = allStudentsRes.rows.filter((u: any) => new Date(u.created_at) <= day).length;
            return {
                day: dayData.day,
                count: count
            }
        });


        res.json({
            summary: summaryRes.rows[0] || {},
            mistakeRanking: mistakeRankingRes.rows,
            studentGrowth: cumulativeStudents,
            dailyAttempts: dailyAttemptsRes.rows
        });

    } catch (err) {
        return handleDbError(res, err, 'Get Dashboard Analytics');
    }
});


app.get('/api/analytics/genre/:genre', requireTeacher, async (req: express.Request, res: express.Response) => {
    const { genre } = req.params;
    try {
        const result = await pgPool.query(`
            SELECT
                u.username,
                q.subgenre,
                COUNT(a.id) as total_attempts,
                SUM(CASE WHEN is_correct = TRUE THEN 1 ELSE 0 END) as correct_attempts
            FROM users u
            CROSS JOIN (SELECT DISTINCT subgenre FROM quizzes WHERE genre = $1) as sg
            LEFT JOIN quizzes q ON sg.subgenre = q.subgenre AND q.genre = $1
            LEFT JOIN attempts a ON u.id = a.user_id AND q.id = a.quiz_id
            WHERE u.role = 'student'
            GROUP BY u.username, sg.subgenre
            ORDER BY u.username, sg.subgenre;
        `, [genre]);

        const results: any = {};
        result.rows.forEach((row: any) => {
            if (!results[row.username]) {
                results[row.username] = {};
            }
            results[row.username][row.subgenre] = {
                total_attempts: parseInt(row.total_attempts, 10),
                correct_attempts: parseInt(row.correct_attempts || 0, 10)
            };
        });
        res.json(results);
    } catch (err) {
        return handleDbError(res, err, 'Get Genre Analytics');
    }
});


app.get('/api/analytics/:username', requireTeacher, async (req: express.Request, res: express.Response) => {
    const { username } = req.params;
    const { genre, subgenre } = req.query;
    try {
        let sql = `SELECT a.timestamp, q.question, a.is_correct FROM attempts a JOIN users u ON a.user_id = u.id JOIN quizzes q ON a.quiz_id = q.id WHERE u.username = $1`;
        const params: (string | undefined)[] = [username];
        let paramCount = 2;
        if (genre) { sql += ` AND q.genre = $${paramCount++}`; params.push(genre as string); }
        if (subgenre) { sql += ` AND q.subgenre = $${paramCount++}`; params.push(subgenre as string); }
        sql += " ORDER BY a.timestamp DESC";
        const result = await pgPool.query(sql, params);
        res.json(result.rows);
    } catch (err) {
        return handleDbError(res, err, 'Get User Detail Analytics');
    }
});

app.post('/api/study_session/start', requireLogin, async (req: express.Request, res: express.Response) => {
    try {
        const result = await pgPool.query("INSERT INTO study_sessions (user_id) VALUES ($1) RETURNING id", [req.session.user!.id]);
        res.status(201).json({ studySessionId: result.rows[0].id });
    } catch (err) {
        return handleDbError(res, err, 'Start Study Session');
    }
});

app.post('/api/study_session/end', requireLogin, async (req: express.Request, res: express.Response) => {
    const { studySessionId } = req.body;
    if (!studySessionId) { return res.status(400).json({ error: 'セッションIDが必要です。' }); }
    try {
        await pgPool.query("UPDATE study_sessions SET end_time = CURRENT_TIMESTAMP WHERE id = $1 AND user_id = $2", [studySessionId, req.session.user!.id]);
        res.status(200).json({ message: '学習セッションを終了しました。' });
    } catch (err) {
        return handleDbError(res, err, 'End Study Session');
    }
});

app.get('/api/analytics/student', requireLogin, async (req: express.Request, res: express.Response) => {
    const userId = req.session.user!.id;
    try {
        const todayStatsQuery = `
            SELECT
                COALESCE(SUM(EXTRACT(EPOCH FROM (end_time - start_time))), 0) / 60 as total_minutes,
                (SELECT COUNT(*) FROM attempts WHERE user_id = $1 AND timestamp::date = CURRENT_DATE) as total_attempts,
                (SELECT CAST(SUM(CASE WHEN is_correct = TRUE THEN 1 ELSE 0 END) AS FLOAT) / NULLIF(COUNT(*), 0) * 100 FROM attempts WHERE user_id = $1 AND timestamp::date = CURRENT_DATE) as accuracy
            FROM study_sessions
            WHERE user_id = $1 AND start_time::date = CURRENT_DATE;
        `;
        
        const previousDayStatsQuery = `
             SELECT
                COALESCE(SUM(EXTRACT(EPOCH FROM (end_time - start_time))), 0) / 60 as total_minutes_prev
            FROM study_sessions
            WHERE user_id = $1 AND start_time::date = CURRENT_DATE - interval '1 day';
        `;

        const weeklyActivityQuery = `
            SELECT 
                d.day::date,
                COALESCE(SUM(EXTRACT(EPOCH FROM (ss.end_time - ss.start_time))), 0) / 60 as minutes
            FROM generate_series(CURRENT_DATE - interval '6 days', CURRENT_DATE, '1 day') d(day)
            LEFT JOIN study_sessions ss ON ss.start_time::date = d.day::date AND ss.user_id = $1
            GROUP BY d.day
            ORDER BY d.day;
        `;

        const [todayRes, weeklyRes, prevDayRes] = await Promise.all([
            pgPool.query(todayStatsQuery, [userId]),
            pgPool.query(weeklyActivityQuery, [userId]),
            pgPool.query(previousDayStatsQuery, [userId])
        ]);

        res.json({
            summary: todayRes.rows[0],
            weeklyActivity: weeklyRes.rows,
            previousDaySummary: prevDayRes.rows[0]
        });
    } catch (err) {
        return handleDbError(res, err, 'Get Student Analytics');
    }
});


app.get('/api/accounts', requireLogin, async (req: express.Request, res: express.Response) => {
    try {
        const result = await pgPool.query("SELECT * FROM account_options ORDER BY reading");
        res.json(result.rows);
    } catch (err) {
        return handleDbError(res, err, 'Get Accounts');
    }
});
app.post('/api/accounts', requireTeacher, async (req: express.Request, res: express.Response) => {
    const { name, reading } = req.body;
    try {
        const result = await pgPool.query("INSERT INTO account_options (name, reading) VALUES ($1, $2) RETURNING *", [name, reading]);
        res.status(201).json(result.rows[0]);
    } catch (err: any) {
        if (err.code === '23505') { return res.status(409).json({ error: 'その勘定科目は既に存在します。' }); }
        return handleDbError(res, err, 'Create Account');
    }
});
app.put('/api/accounts/:id', requireTeacher, async (req: express.Request, res: express.Response) => {
    const { id } = req.params;
    const { name, reading } = req.body;
    try {
        const result = await pgPool.query("UPDATE account_options SET name = $1, reading = $2 WHERE id = $3 RETURNING *", [name, reading, id]);
        if (result.rowCount === 0) { return res.status(404).json({ error: '勘定科目が見つかりません。' }); }
        res.json(result.rows[0]);
    } catch (err: any) {
        if (err.code === '23505') { return res.status(409).json({ error: 'その勘定科目名は既に存在します。' }); }
        return handleDbError(res, err, 'Update Account');
    }
});
app.delete('/api/accounts/:id', requireTeacher, async (req: express.Request, res: express.Response) => {
    const { id } = req.params;
    try {
        const result = await pgPool.query("DELETE FROM account_options WHERE id = $1", [id]);
        if (result.rowCount === 0) { return res.status(404).json({ error: '問題が見つかりません。' }); }
        res.status(204).send();
    } catch (err) {
        return handleDbError(res, err, 'Delete Account');
    }
});

// --- サーバー起動 ---
const startServer = async () => {
    try {
        await initializeDb();
        app.listen(port, () => {
            console.log(`サーバーが http://localhost:${port} で起動しました`);
        });
    } catch (err) {
        console.error("サーバーの起動に失敗しました:", err);
        process.exit(1);
    }
};

startServer();

