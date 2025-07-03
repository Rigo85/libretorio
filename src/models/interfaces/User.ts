export interface User {
	id: string;
	email: string;
	passwordHash: string;
	isAdmin: boolean;
	preferences: any;
	isActive: boolean;
	createdAt: Date;
}
