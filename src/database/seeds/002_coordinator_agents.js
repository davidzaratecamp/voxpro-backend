/**
 * Asigna los agentes a cada coordinador claro_tyt.
 * Jenny, Fabian y Nicole solo verán sus agentes asignados.
 * Kevin (sin agent_names) ve todos los no escaneados por los demás.
 */
const COORDINATORS = [
  {
    name: 'Cely Alviz Fabian Andres',
    agent_names: [
      'Duran Losada Harrison Steven',
      'Rojas Vargas Yessica Milena',
      'Aldana Garcia Nicolas',
      'Castro Corredor Yurani Alejandra',
      'Mendieta Hernandez Kevin Ayrton',
      'Pinzon Rozo Charith Juliana',
      'Rodriguez Florian Keila Alejandra',
      'Galindo Barbosa Carol Gabriela',
      'Mora Martinez Nicolas David',
      'Verdugo Pesca Yiret Nicol',
      'Rodriguez Abello Cristhian Daniel',
      'Suescun Triana Julieth Andrea',
      'Ramirez Mancilla Duvan Marcelo',
      'Olaya Moya Jhonny Alejandro',
      'Herrera Cruz Yilary Alejandra',
    ],
  },
  {
    name: 'Corredor Barbosa Nicole Valeria',
    agent_names: [
      'Duarte Gonzalez Valentina',
      'Amaya Silva Santiago',
      'Carrillo Lis Jhon Sebastian',
      'Polo Castillo Nathalia Joselin',
      'Iguaran Fontalvo Juan Camilo',
      'Escuraina Benitez Sebastian David',
      'Rodriguez Toledo Madeline Elizabeth',
      'Corredor Otalora Daniel Esteban',
      'Gutierrez Barros Yurainis',
      'Alba Corredor Richarth Ferney',
      'Rojas Prieto Darys Lisbeth',
      'Vargas Daza Yessica Richely',
      'Monroy Forero Pedro Andre',
      'Quintero Aguirre Jose David',
      'Malaver Enciso Juan David',
      'Paez Mejia Lina Fernanda',
    ],
  },
  {
    name: 'Torres Higuera Jenny Viviana',
    agent_names: [
      'Rodriguez Alquichides Jhiran Jhonney',
      'Piedrahita Perez Danna Marcela',
      'Viscue Gonzalez Karen Dayanna',
      'Florez Herrera Valerin Lorayne',
      'Perdomo Campo Angie Lorena',
      'Jacome Lopez Jonathan',
      'Velasquez Lugo Jorge Camilo',
      'Cardenas Isaza Kelly Tatiana',
      'Henao Barragan Mayerli Yeraldin',
      'Ramos Quiroga Andreina',
      'Culma Tique Edinson Duvay',
      'Uribe Sanchez Jireh Alexandra',
      'Chacon Robles Eileen Yuliana',
      'Masmela Estupinan Yuri Alejandra',
      'Porto Julio Maria Alejandra',
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
      .update({ agent_names: JSON.stringify(coord.agent_names) });
    console.log(`agent_names actualizado para ${coord.name} (${coord.agent_names.length} agentes)`);
  }
};
