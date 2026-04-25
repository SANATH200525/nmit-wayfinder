nodes = {

    # -- GROUND FLOOR (floor: 1) -------------------------------------
    'MAINENTRANCE-GF':      {'coords': (77, 58), 'floor': 1, 'label': 'Main Entrance',         'category': 'Entrance'},
    'OFFICE-GF':            {'coords': (73, 42), 'floor': 1, 'label': 'Office',                'category': 'Offices'},
    'ADMIN-GF':             {'coords': (75, 63), 'floor': 1, 'label': 'Admin Office',          'category': 'Offices'},
    'TUTORIAL-GF':          {'coords': (68, 62), 'floor': 1, 'label': 'Tutorial Room',         'category': 'Rooms'},
    'CONFERENCEROOM1-GF':   {'coords': (49, 58), 'floor': 1, 'label': 'Conference Room 1',     'category': 'Rooms'},
    'CONFERENCEROOM2-GF':   {'coords': (53, 58), 'floor': 1, 'label': 'Conference Room 2',     'category': 'Rooms'},
    'COMPUTERLAB-GF':       {'coords': (44, 59), 'floor': 1, 'label': 'Computer Lab',          'category': 'Labs & Rooms'},
    'CLASSROOM-GF':         {'coords': (34, 58), 'floor': 1, 'label': 'Lecture Hall - 1',      'category': 'Rooms'},
    'LIBRARY-GF':           {'coords': (24, 59), 'floor': 1, 'label': 'Library',               'category': 'Offices'},
    'PRINCIPALROOM-GF':     {'coords': (20, 59), 'floor': 1, 'label': "Principal's Room",      'category': 'Offices'},
    'RESTROOMS-GF':         {'coords': (14, 56), 'floor': 1, 'label': 'Restrooms',             'category': 'Restrooms'},
    'LIFT-GF':              {'coords': (72, 52), 'floor': 1, 'label': 'Lift (Ground Floor)',   'category': 'Lift & Stairs'},
    'CURVEDSTAIRS-GF':      {'coords': (77, 43), 'floor': 1, 'label': 'Curved Stairs (Ground Floor)', 'category': 'Lift & Stairs'},
    'STAIRSEND-GF':         {'coords': (11, 55), 'floor': 1, 'label': 'Stairs End (Ground Floor)',   'category': 'Lift & Stairs'},
    # GF waypoints
    'HALLWAY-TURNPOINT-1-GF': {'coords': (74, 58), 'floor': 1, 'label': 'GF Turn 1', 'is_waypoint': True},
    'HALLWAY-TURNPOINT-2-GF': {'coords': (39, 59), 'floor': 1, 'label': 'GF Turn 2', 'is_waypoint': True},
    'HALLWAY-TURNPOINT-3-GF': {'coords': (12, 60), 'floor': 1, 'label': 'GF Turn 3 (End)', 'is_waypoint': True},

    # -- FIRST FLOOR (floor: 2) --------------------------------------
    'MEDIAUNIT-1F':         {'coords': (71, 42), 'floor': 2, 'label': 'Media Unit',            'category': 'Rooms'},
    'BALCONY-1F':           {'coords': (75, 60), 'floor': 2, 'label': 'Balcony - North Wing',  'category': 'Rooms', 'dead_end': True},
    'ROOM1-1F':             {'coords': (66, 64), 'floor': 2, 'label': 'Lecture Hall - 2',      'category': 'Rooms'},
    'SEMINARHALL-1F':       {'coords': (55, 62), 'floor': 2, 'label': 'Seminar Hall',          'category': 'Labs & Rooms'},
    'DESIGNLAB-1F':         {'coords': (52, 58), 'floor': 2, 'label': 'Design Thinking Lab',   'category': 'Labs & Rooms'},
    'UPSROOM-1F':           {'coords': (47, 60), 'floor': 2, 'label': 'UPS Room',              'category': 'Rooms'},
    'STAFFROOM1-1F':        {'coords': (33, 60), 'floor': 2, 'label': 'Staff Room 1',          'category': 'Offices'},
    'STAFFROOM2-1F':        {'coords': (36, 30), 'floor': 2, 'label': 'Staff Room 2',          'category': 'Offices'},
    'ROOM3-1F':             {'coords': (37, 27), 'floor': 2, 'label': 'Discussion Room - 1',   'category': 'Rooms'},
    'BOARDROOM-1F':         {'coords': (22, 61), 'floor': 2, 'label': 'Board Room',            'category': 'Rooms'},
    'ROOM2-1F':             {'coords': (19, 61), 'floor': 2, 'label': 'Lecture Hall - 3',      'category': 'Rooms'},
    'RESTROOMS-1F':         {'coords': (13, 57), 'floor': 2, 'label': 'Restrooms',             'category': 'Restrooms'},
    'LIFT-1F':              {'coords': (69, 53), 'floor': 2, 'label': 'Lift (First Floor)',    'category': 'Lift & Stairs'},
    'CURVEDSTAIRS-1F':      {'coords': (74, 42), 'floor': 2, 'label': 'Curved Stairs (First Floor)', 'category': 'Lift & Stairs'},
    'STAIRSEND-1F':         {'coords': ( 9, 58), 'floor': 2, 'label': 'Stairs End (First Floor)',   'category': 'Lift & Stairs'},
    # 1F waypoints
    'HALLWAY-TURNPOINT-1-1F': {'coords': (72, 59), 'floor': 2, 'label': '1F Turn 1', 'is_waypoint': True},
    'HALLWAY-TURNPOINT-2-1F': {'coords': (36, 59), 'floor': 2, 'label': '1F Turn 2', 'is_waypoint': True},
    'HALLWAY-TURNPOINT-3-1F': {'coords': (11, 62), 'floor': 2, 'label': '1F Turn 3 (End)', 'is_waypoint': True},
    # 1F passageway branch
    'PASSAGEWAY-1F':     {'coords': (36, 59), 'floor': 2, 'label': '1F Passageway Entry', 'is_waypoint': True},
    'PASSAGEWAY-1F-TOP': {'coords': (36, 43), 'floor': 2, 'label': '1F Passageway Top',   'is_waypoint': True},

    # -- SECOND FLOOR (floor: 3) -------------------------------------
    'ALUMNIRELATIONSOFFICE-2F':  {'coords': (67, 42), 'floor': 3, 'label': 'Alumni Relations Office',             'category': 'Offices'},
    'STUDENTCOUNCILROOM-2F':     {'coords': (67, 61), 'floor': 3, 'label': 'Student Council Room',                'category': 'Rooms'},
    'CORPORATERELATIONSDEPT-2F': {'coords': (70, 61), 'floor': 3, 'label': 'Corporate Relations Department',      'category': 'Offices'},
    'CASESTUDYLAB1-2F':          {'coords': (45, 58), 'floor': 3, 'label': 'Case Study Lab 1',                    'category': 'Labs & Rooms'},
    'CASESTUDYLAB2-2F':          {'coords': (50, 58), 'floor': 3, 'label': 'Case Study Lab 2',                    'category': 'Labs & Rooms'},
    'RESEARCHDEPT-2F':           {'coords': (40, 60), 'floor': 3, 'label': 'Research & Publication Centre',       'category': 'Offices'},
    'FACULTYLOUNGE-2F':          {'coords': (31, 58), 'floor': 3, 'label': 'Faculty Lounge',                      'category': 'Offices'},
    'ENTREPRENEURSHIPCELL-2F':   {'coords': (21, 60), 'floor': 3, 'label': 'Entrepreneurship Cell',               'category': 'Offices'},
    'PLACEMENTCELL-2F':          {'coords': (18, 61), 'floor': 3, 'label': 'Placement Cell & Career Counseling',  'category': 'Offices'},
    'RESTROOMS-2F':              {'coords': (13, 57), 'floor': 3, 'label': 'Restrooms',                           'category': 'Restrooms'},
    'LIFT-2F':                   {'coords': (66, 52), 'floor': 3, 'label': 'Lift (Second Floor)',                  'category': 'Lift & Stairs'},
    'CURVEDSTAIRS-2F':           {'coords': (70, 43), 'floor': 3, 'label': 'Curved Stairs (Second Floor)',         'category': 'Lift & Stairs'},
    'STAIRSEND-2F':              {'coords': ( 9, 57), 'floor': 3, 'label': 'Stairs End (Second Floor)',            'category': 'Lift & Stairs'},
    # 2F waypoints
    'HALLWAY-TURNPOINT-1-2F': {'coords': (69, 57), 'floor': 3, 'label': '2F Turn 1', 'is_waypoint': True},
    'HALLWAY-TURNPOINT-2-2F': {'coords': (11, 60), 'floor': 3, 'label': '2F Turn 2 (End)', 'is_waypoint': True},
    'HALLWAY-TURNPOINT-3-2F': {'coords': (40, 58), 'floor': 3, 'label': '2F Turn 3', 'is_waypoint': True},

    # -- THIRD FLOOR (floor: 4) --------------------------------------
    'ROOM1-3F':     {'coords': (33, 59), 'floor': 4, 'label': 'Lecture Hall - 4',          'category': 'Rooms'},
    'ROOM2-3F':     {'coords': (47, 59), 'floor': 4, 'label': 'Seminar Room - 1',          'category': 'Rooms'},
    'ROOM3-3F':     {'coords': (52, 59), 'floor': 4, 'label': 'Seminar Room - 2',          'category': 'Rooms'},
    'ROOM4-3F':     {'coords': (70, 43), 'floor': 4, 'label': 'Lecture Hall - 5',          'category': 'Rooms'},
    'RESTROOMS-3F': {'coords': (13, 57), 'floor': 4, 'label': 'Restrooms',                 'category': 'Restrooms'},
    'LIFT-3F':      {'coords': (69, 53), 'floor': 4, 'label': 'Lift (Third Floor)',         'category': 'Lift & Stairs'},
    'CURVEDSTAIRS-3F': {'coords': (74, 43), 'floor': 4, 'label': 'Curved Stairs (Third Floor)', 'category': 'Lift & Stairs'},
    'STAIRSEND-3F': {'coords': ( 9, 57), 'floor': 4, 'label': 'Stairs End (Third Floor)',  'category': 'Lift & Stairs'},
    # 3F waypoints
    'HALLWAY-TURNPOINT-1-3F': {'coords': (72, 58), 'floor': 4, 'label': '3F Turn 1', 'is_waypoint': True},
    'HALLWAY-TURNPOINT-2-3F': {'coords': (12, 60), 'floor': 4, 'label': '3F Turn 2 (End)', 'is_waypoint': True},
    'HALLWAY-TURNPOINT-3-3F': {'coords': (41, 59), 'floor': 4, 'label': '3F Turn 3', 'is_waypoint': True},
}


FLOOR_DISPLAY = {1: 'Ground Floor', 2: 'First Floor', 3: 'Second Floor', 4: 'Third Floor'}
CATEGORY_ORDER = ['Entrance', 'Offices', 'Rooms', 'Labs & Rooms', 'Restrooms', 'Lift & Stairs']

# Normalize node typing for safer checks
for _nid, _data in nodes.items():
    if _data.get('is_waypoint'):
        _data['type'] = 'hallway'
    elif _nid.startswith('LIFT'):
        _data['type'] = 'lift'
    elif 'STAIRS' in _nid:
        _data['type'] = 'stairs'
        _data['stairs_kind'] = 'curved' if 'CURVED' in _nid else 'straight'
    else:
        _data['type'] = 'room'

