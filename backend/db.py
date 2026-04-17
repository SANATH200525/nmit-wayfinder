import sqlite3
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
DB_PATH = str(BASE_DIR / 'feedback.db')


def get_db():
    conn = sqlite3.connect(DB_PATH, timeout=10, check_same_thread=False)
    try:
        yield conn
    finally:
        conn.close()


def init_db():
    """Create feedback + edge_weights + faq tables if they do not exist."""
    conn = sqlite3.connect(DB_PATH)
    try:
        conn.execute('PRAGMA journal_mode=WAL;')
        conn.execute('''CREATE TABLE IF NOT EXISTS feedback (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT, start TEXT, end TEXT,
            path TEXT, rating INTEGER, comment TEXT
        )''')
        conn.execute('CREATE INDEX IF NOT EXISTS idx_feedback_route ON feedback (start, end);')
        conn.execute('''CREATE TABLE IF NOT EXISTS edge_weights (
            edge TEXT PRIMARY KEY, multiplier REAL DEFAULT 1.0
        )''')
        conn.execute('''CREATE TABLE IF NOT EXISTS faq (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            keywords TEXT NOT NULL,
            answer TEXT NOT NULL,
            active INTEGER DEFAULT 1
        )''')
        conn.execute('''CREATE TABLE IF NOT EXISTS route_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL UNIQUE,
            start_node TEXT NOT NULL,
            end_node TEXT NOT NULL,
            mobility TEXT NOT NULL,
            planned_path TEXT NOT NULL,
            planned_distance_m REAL,
            algorithm TEXT DEFAULT 'bda_star_js',
            timestamp TEXT NOT NULL,
            online INTEGER DEFAULT 1
        )''')
        conn.execute('''CREATE TABLE IF NOT EXISTS pdr_observations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL,
            timestamp TEXT NOT NULL,
            estimated_x REAL,
            estimated_y REAL,
            floor INTEGER,
            nearest_node TEXT,
            distance_to_nearest_m REAL,
            confidence REAL
        )''')
        conn.execute('''CREATE TABLE IF NOT EXISTS route_accuracy_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL,
            timestamp TEXT NOT NULL,
            checkpoint_index INTEGER,
            checkpoint_node_id TEXT,
            user_confirmed INTEGER DEFAULT 0,
            deviation_m REAL,
            on_correct_path INTEGER
        )''')
        conn.commit()
        count = conn.execute('SELECT COUNT(*) FROM faq').fetchone()[0]
        if count == 0:
            seed = [
                ('where is the library,find library,library location',
                 'The Library is on the Ground Floor, along the left side of the main corridor.'),
                ('principal office,where is principal,principals room,principal room',
                 "The Principal's Room is on the Ground Floor, near the far left end of the corridor."),
                ('admin office,administration,where is admin',
                 'The Admin Office is on the Ground Floor, near the main entrance on the right side.'),
                ('office ground floor,ground floor office,where is office',
                 'The Office is on the Ground Floor beside the lift and curved stairs cluster.'),
                ('tutorial room,where is tutorial',
                 'The Tutorial Room is on the Ground Floor, just left of the admin office area.'),
                ('computer lab,where is computer lab,lab location',
                 'The Computer Lab is on the Ground Floor in the middle section of the main corridor.'),
                ('conference room 1,conf room 1,conference room one',
                 'Conference Room 1 is on the Ground Floor, to the right of the computer lab.'),
                ('conference room 2,conf room 2,conference room two',
                 'Conference Room 2 is on the Ground Floor, near the computer lab and classroom cluster.'),
                ('conference room,conference rooms,meeting room',
                 'Conference Room 1 and Conference Room 2 are both on the Ground Floor near the centre corridor.'),
                ('classroom,class room,where is classroom',
                 'The Classroom is on the Ground Floor, between the computer lab area and the library side.'),
                ('seminar hall,where is seminar hall,seminar room',
                 'The Seminar Hall is on the First Floor near the central corridor.'),
                ('design lab,design thinking,design thinking lab',
                 'The Design Thinking Lab is on the First Floor beside the Seminar Hall.'),
                ('ups room,ups,server room',
                 'The UPS Room is on the First Floor beside the Seminar Hall and Design Thinking Lab.'),
                ('board room,where is board room,boardroom',
                 'The Board Room is on the First Floor toward the left side of the corridor.'),
                ('media unit,media room,media',
                 'The Media Unit is on the First Floor near the lift and curved stairs.'),
                ('staff room 1,staffroom1',
                 'Staff Room 1 is on the First Floor along the main corridor.'),
                ('staff room 2,staffroom2',
                 'Staff Room 2 is on the First Floor up the passageway branch from the main corridor.'),
                ('room 3 first floor,room3 first floor,room 3 on first floor',
                 'Room 3 is on the First Floor up the passageway branch near Staff Room 2.'),
                ('alumni,alumni office,alumni relations',
                 'The Alumni Relations Office is on the Second Floor near the right-side curved stairs.'),
                ('corporate relations,corporate office,corporate relations department',
                 'The Corporate Relations Department is on the Second Floor near the Student Council Room.'),
                ('student council,student council room',
                 'The Student Council Room is on the Second Floor near the right side of the corridor.'),
                ('research,publication,research centre,research department',
                 'The Research and Publication Centre is on the Second Floor near the middle corridor.'),
                ('case study lab,case study lab 1,case study lab 2',
                 'Case Study Lab 1 and Case Study Lab 2 are on the Second Floor near the middle corridor.'),
                ('faculty lounge,staff lounge,faculty room',
                 'The Faculty Lounge is on the Second Floor along the main corridor.'),
                ('entrepreneurship,e-cell,entrepreneurship cell',
                 'The Entrepreneurship Cell is on the Second Floor toward the left side of the corridor.'),
                ('placement cell,placement office,placements,career counseling',
                 'The Placement Cell and Career Counseling office is on the Second Floor near the left side of the corridor.'),
                ('room 1 third floor,room1 third floor,room 1 on third floor',
                 'Room 1 is on the Third Floor along the main corridor.'),
                ('room 2 third floor,room2 third floor,room 2 on third floor',
                 'Room 2 is on the Third Floor along the main corridor.'),
                ('room 3 third floor,room3 third floor,room 3 on third floor',
                 'Room 3 is on the Third Floor along the main corridor.'),
                ('room 4 third floor,room4 third floor,room 4 on third floor',
                 'Room 4 is on the Third Floor near the right-side lift and curved stairs cluster.'),
                ('where is the lift,elevator location,find lift',
                 'The lift is beside the main entrance on the Ground Floor and serves all four floors.'),
                ('stairs,staircase,where are the stairs,main stairs,curved stairs',
                 'There are main stairs at the left end of each floor and curved stairs near the lift cluster on the right side.'),
                ('restroom,toilet,washroom,bathroom,where is toilet',
                 'Restrooms are available on every floor near the left end of the corridor.'),
                ('wheelchair,accessible,disability,mobility',
                 'Use Elevator Only mode for wheelchair-accessible routes so the app avoids both staircases.'),
                ('balcony,where is balcony',
                 'The Balcony is on the First Floor beside the lift cluster.'),
                ('how to use,how does this work,how to navigate',
                 'Select your current location, choose your destination, then tap Initiate Route. The map shows turn-by-turn directions.'),
                ('add stop,multiple stops,via,intermediate stop',
                 'Tap the Add Stop button to add an intermediate stop on your route.'),
                ('floor changes,what does floor changes mean',
                 'Floor Changes shows how many different floors your route passes through.'),
                ('checkpoint,what is checkpoint,reached checkpoint',
                 'Checkpoints mark key turns along your route. Tap Reached Checkpoint to advance navigation.'),
            ]
            conn.executemany('INSERT INTO faq (keywords, answer) VALUES (?, ?)', seed)
            conn.commit()
    finally:
        conn.close()

