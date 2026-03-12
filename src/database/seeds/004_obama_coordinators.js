/**
 * Crea los usuarios coordinadores de Obama (Jorge Patiño, Julissa Diaz, Katerine Suarez).
 * Cada coordinador ve TODOS sus agentes sin importar la campaña.
 * Los agent_ids se toman directamente de segmentacionObama.js (cédulas).
 */
const bcrypt = require('bcrypt');

exports.seed = async function (knex) {
  const hash = await bcrypt.hash('password', 10);

  const coordinators = [
    {
      username: 'jorge_patino',
      name: 'Jorge Patiño',
      agentIds: [
        '1001029797', // Salgado Manjarres Any Yisela (ACA)
        '1012335146', // Bejarano Miranda Geidy Tatiana (ACA)
        '1110468057', // Rodriguez Leon Karen Lorena (ACA)
        '1021666020', // Torres Triana Nazly Anjelyn (PRO 100)
        '1010021689', // Bejarano Obando Natalia Vanessa (PRO 100)
        '1000330143', // Acosta Mesa Kevin Santiago (PRO 100)
        '1103981404', // Mendoza Mercado Letty Sofia (PRO 100)
        '1000776704', // Rey Carrero Cristian (USA)
        '1019142117', // Hurtado Moreno Dina (USA)
      ],
      agentNames: [
        'Salgado Manjarres Any Yisela',
        'Bejarano Miranda Geidy Tatiana',
        'Rodriguez Leon Karen Lorena',
        'Torres Triana Nazly Anjelyn',
        'Bejarano Obando Natalia Vanessa',
        'Acosta Mesa Kevin Santiago',
        'Mendoza Mercado Letty Sofia',
        'Rey Carrero Cristian',
        'Hurtado Moreno Dina',
      ],
    },
    {
      username: 'julissa_diaz',
      name: 'Julissa Diaz',
      agentIds: [
        '1023364825', // Escobar Torres Andres Felipe (CHOCK)
        '1013652243', // Meléndez Pico Tatiana Paola (CHOCK)
        '1012441401', // Suárez Omar Montoya (CHOCK)
        '1013689123', // Cardenas Carrillo Diego Alejandro (CHOCK)
      ],
      agentNames: [
        'Escobar Torres Andres Felipe',
        'Meléndez Pico Tatiana Paola',
        'Suárez Omar Montoya',
        'Cardenas Carrillo Diego Alejandro',
      ],
    },
    {
      username: 'katerine_suarez',
      name: 'Katerine Suarez',
      agentIds: [
        '1030597222', // Bonilla Poveda Richard Alexander (CHOCK)
        '1000622799', // Farfan Acosta Santiago (CHOCK)
        '1022982816', // Sanchez Malpica Jairo Alberto (CHOCK)
        '1022326545', // Chavez Diaz Ronald Andres (CHOCK)
        '1023023709', // Escobar Hernandez Michell Daniela (CHOCK)
        '1022328064', // Piña Rodriguez Cristian Rodolfo (CHOCK)
        '1012464163', // Sebastian Castaño Alvis (CHOCK)
        '1006457064', // Tineo Lopez Alexis Jhomnyver (CHOCK)
      ],
      agentNames: [
        'Bonilla Poveda Richard Alexander',
        'Farfan Acosta Santiago',
        'Sanchez Malpica Jairo Alberto',
        'Chavez Diaz Ronald Andres',
        'Escobar Hernandez Michell Daniela',
        'Piña Rodriguez Cristian Rodolfo',
        'Sebastian Castaño Alvis',
        'Tineo Lopez Alexis Jhomnyver',
      ],
    },
  ];

  for (const coord of coordinators) {
    const exists = await knex('users').where('username', coord.username).first();
    if (!exists) {
      await knex('users').insert({
        username: coord.username,
        password_hash: hash,
        name: coord.name,
        role: 'coordinator_obama',
        client_codes: JSON.stringify(['obama']),
        agent_names: JSON.stringify(coord.agentNames),
        agent_ids: JSON.stringify(coord.agentIds),
        active: true,
      });
      console.log(`✓ Creado: ${coord.name} (${coord.agentIds.length} agentes)`);
    } else {
      await knex('users').where('username', coord.username).update({
        agent_names: JSON.stringify(coord.agentNames),
        agent_ids: JSON.stringify(coord.agentIds),
        role: 'coordinator_obama',
        client_codes: JSON.stringify(['obama']),
      });
      console.log(`✓ Actualizado: ${coord.name} (${coord.agentIds.length} agentes)`);
    }

    console.log(`  Agentes: ${coord.agentIds.join(', ')}`);
  }
};
