/**
 * Asigna las cédulas (agent_id) de cada coordinador claro_tyt.
 * IDs obtenidos directamente de la tabla recordings para garantizar coincidencia exacta.
 */
const COORDINATORS = [
  {
    name: 'Torres Higuera Jenny Viviana',
    agent_ids: [
      '1000135026', // Rodriguez Alquichides Jhiran Jhonney
      '1000338572', // Piedrahita Perez Danna Marcela
      '1123204669', // Viscue Gonzalez Karen Dayanna
      '1026257290', // Florez Herrera Valerin Lorayne
      '1028882095', // Perdomo Campo Angie Lorena
      '1088354554', // Jacome Lopez Jonathan
      '1014264362', // Velasquez Lugo Jorge Camilo
      '1033784868', // Cardenas Isaza Kelly Tatiana
      '1022963693', // Henao Barragan Mayerli Yeraldin
      '1057488201', // Ramos Quiroga Andreina
      '1117233399', // Culma Tique Edinson Duvay
      '1019762964', // Uribe Sanchez Jireh Alexandra
      '1143236619', // Chacon Robles Eileen Yuliana
      '1015471118', // Masmela Estupinan Yuri Alejandra
      '1101442138', // Porto Julio Maria Alejandra
    ],
  },
  {
    name: 'Cely Alviz Fabian Andres',
    agent_ids: [
      '1000163555', // Duran Losada Harrison Steven
      '1026583695', // Rojas Vargas Yessica Milena
      '1012316477', // Aldana Garcia Nicolas
      '1000325844', // Castro Corredor Yurani Alejandra
      '1074808721', // Mendieta Hernandez Kevin Ayrton
      '1030541509', // Pinzon Rozo Charith Juliana
      '1082350416', // Rodriguez Florian Keila Alejandra
      '1000940658', // Galindo Barbosa Carol Gabriela
      '1073682280', // Mora Martinez Nicolas David
      '1022952511', // Verdugo Pesca Yiret Nicol
      '1000288234', // Rodriguez Abello Cristhian Daniel
      '1013102757', // Suescun Triana Julieth Andrea
      '1094347374', // Ramirez Mancilla Duvan Marcelo
      '1027520405', // Olaya Moya Jhonny Alejandro
      '1034287904', // Herrera Cruz Yilary Alejandra
    ],
  },
  {
    name: 'Corredor Barbosa Nicole Valeria',
    agent_ids: [
      '1013577488', // Duarte Gonzalez Valentina
      '1000184569', // Amaya Silva Santiago
      '1000217170', // Carrillo Lis Jhon Sebastian
      '1007896113', // Polo Castillo Nathalia Joselin
      '1042249222', // Iguaran Fontalvo Juan Camilo
      '1028883232', // Escuraina Benitez Sebastian David
      '1031649688', // Rodriguez Toledo Madeline Elizabeth
      '1033704402', // Corredor Otalora Daniel Esteban
      '1031804408', // Gutierrez Barros Yurainis
      '1000619829', // Alba Corredor Richarth Ferney
      '1000722586', // Rojas Prieto Darys Lisbeth
      '1048848037', // Vargas Daza Yessica Richely
      '1010219576', // Monroy Forero Pedro Andre
      '1000791996', // Quintero Aguirre Jose David
      '1073598727', // Malaver Enciso Juan David
      '1022424860', // Paez Mejia Lina Fernanda
    ],
  },
];

exports.seed = async function (knex) {
  for (const coord of COORDINATORS) {
    const user = await knex('users').where('name', coord.name).first();
    if (!user) {
      console.warn(`Usuario no encontrado: ${coord.name}`);
      continue;
    }
    await knex('users')
      .where('id', user.id)
      .update({ agent_ids: JSON.stringify(coord.agent_ids) });
    console.log(`agent_ids actualizado para ${coord.name} (${coord.agent_ids.length} agentes)`);
  }
};
